import { streamGeminiText } from "./modelProvider.js";
import { ANIMATION_SYSTEM } from "./animationConfig.js";
import {
    parseAnimationLine,
    buildAnimationPrompt,
    getAnimationProgress
} from "./animationCore.js";
import { R6_JOINTS } from "./r6.js";

function consumeLines(buffer, chunk, onMessage) {
    const combined = buffer + chunk;
    const lines = combined.split(/\r?\n/);
    const remainder = lines.pop() || "";

    for (const line of lines) {
        const message = parseAnimationLine(line);
        if (message) onMessage(message);
    }
    return remainder;
}

function createFrameAssembler() {
    const neutralPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
    return {
        lastTime: -1,
        activeTime: null,
        pendingJoints: {},
        touched: new Set(),
        previousJoints: Object.fromEntries(
            R6_JOINTS.map((name) => [name, { ...neutralPose }])
        )
    };
}

function acceptJointAction(state, message) {
    if (state.activeTime === null) {
        if (message.time <= state.lastTime) {
            throw new Error("Los tiempos de las acciones deben ser crecientes.");
        }
        state.activeTime = message.time;
    } else if (Math.abs(message.time - state.activeTime) > 0.0005) {
        throw new Error("La IA cambió de tiempo antes de cerrar el frame del rig.");
    }

    if (state.touched.has(message.joint)) {
        throw new Error(`La IA repitió ${message.joint} en el mismo tiempo.`);
    }

    state.touched.add(message.joint);
    state.pendingJoints[message.joint] = message.pose;
    return state.touched.size;
}

function closeFrame(state, time) {
    if (state.activeTime === null) {
        throw new Error("La IA intentó cerrar un frame sin acciones de articulación.");
    }
    if (Math.abs(time - state.activeTime) > 0.0005) {
        throw new Error("El cierre de frame no coincide con el tiempo de sus acciones.");
    }
    if (state.touched.size === 0) {
        throw new Error("El frame no contiene acciones.");
    }
    if (state.lastTime < 0 && state.touched.size !== R6_JOINTS.length) {
        throw new Error("La pose inicial debe definir las seis articulaciones de cada rig R6.");
    }

    const joints = { ...state.previousJoints, ...state.pendingJoints };
    const frame = { type: "keyframe", time: state.activeTime, joints };

    state.lastTime = state.activeTime;
    state.previousJoints = joints;
    state.activeTime = null;
    state.pendingJoints = {};
    state.touched = new Set();
    return frame;
}

function ensureNoOpenFrames(rigStates, timeline) {
    if (timeline.activeTime !== null) {
        throw new Error("La IA terminó antes de cerrar el mismo frame en todos los rigs.");
    }
    for (const state of rigStates.values()) {
        if (state.assembler.activeTime !== null) {
            throw new Error(`El último frame de ${state.rig.rigName} quedó incompleto.`);
        }
    }
}

export async function generateAnimation(session) {
    session.status = "generating";
    console.log(`[SESIÓN ${session.id}] Generando animación completa para ${session.rigs.length} rig(s).`);
    session.emit({
        type: "status",
        status: "connecting_ai",
        message: "Conectando con Antigravity…",
        progress: 1
    });

    const rigStates = new Map(session.rigs.map((rig) => [
        rig.rigId,
        { rig, assembler: createFrameAssembler(), frameCount: 0 }
    ]));
    const rigIds = session.rigs.map((rig) => rig.rigId);
    const timeline = {
        lastTime: -1,
        activeTime: null,
        closedRigIds: new Set()
    };

    let buffer = "";
    let meta = null;
    let completedFrames = 0;
    let modelCompleted = false;

    function processMessage(message) {
        if (message.type === "meta") {
            if (meta) throw new Error("La IA emitió metadatos más de una vez.");
            meta = message;
            session.meta = message;
            console.log(`[SESIÓN ${session.id}] Animación "${message.name}", ${message.duration}s, objetivo ${message.keyframes} frames.`);
            session.emit({
                ...message,
                rigCount: session.rigs.length,
                progress: 2
            });
            return;
        }

        if (!meta) {
            throw new Error("La IA emitió movimientos antes de los metadatos iniciales.");
        }

        if (message.type === "joint") {
            const state = rigStates.get(message.rigId);
            if (!state) {
                throw new Error(`La IA envió una acción para un rig desconocido: ${message.rigId}`);
            }
            if (message.time > meta.duration + 0.03) {
                throw new Error("La acción supera la duración planificada.");
            }

            if (timeline.activeTime === null) {
                if (message.time <= timeline.lastTime) {
                    throw new Error("Los tiempos compartidos deben ser crecientes.");
                }
                timeline.activeTime = message.time;
            } else if (Math.abs(message.time - timeline.activeTime) > 0.0005) {
                throw new Error("Los rigs no están sincronizados: falta cerrar el frame anterior en todos.");
            }

            if (timeline.closedRigIds.has(message.rigId)) {
                throw new Error(`La IA envió más acciones para ${state.rig.rigName} después de cerrar su frame.`);
            }

            const jointCount = acceptJointAction(state.assembler, message);
            const fractionalFrame = completedFrames + jointCount / (R6_JOINTS.length * rigIds.length);
            const progress = getAnimationProgress(fractionalFrame, meta.keyframes);
            session.progress = progress;
            session.emit({
                ...message,
                rigName: state.rig.rigName,
                progress,
                frameJointCount: jointCount,
                frameJointTotal: R6_JOINTS.length
            });
            console.log(`[SESIÓN ${session.id}] ${state.rig.rigName}: ${message.joint} en t=${message.time}s.`);
            return;
        }

        if (message.type === "frame") {
            const state = rigStates.get(message.rigId);
            if (!state) {
                throw new Error(`La IA cerró un frame para un rig desconocido: ${message.rigId}`);
            }
            if (timeline.activeTime === null ||
                Math.abs(message.time - timeline.activeTime) > 0.0005) {
                throw new Error("El frame no coincide con el instante compartido de los rigs.");
            }
            if (timeline.closedRigIds.has(message.rigId)) {
                throw new Error(`La IA cerró dos veces el frame de ${state.rig.rigName}.`);
            }

            const frame = closeFrame(state.assembler, message.time);
            state.frameCount += 1;
            session.keyframes.set(`${message.rigId}:${message.time.toFixed(4)}`, frame);

            timeline.closedRigIds.add(message.rigId);
            const progress = getAnimationProgress(
                completedFrames + timeline.closedRigIds.size / rigIds.length,
                meta.keyframes
            );
            session.progress = progress;
            session.emit({
                type: "frame",
                rigId: message.rigId,
                rigName: state.rig.rigName,
                time: frame.time,
                joints: frame.joints,
                progress,
                receivedFrames: state.frameCount
            });
            console.log(`[SESIÓN ${session.id}] Frame de ${state.rig.rigName} cerrado en t=${frame.time}s.`);

            if (timeline.closedRigIds.size === rigIds.length) {
                completedFrames += 1;
                timeline.lastTime = timeline.activeTime;
                timeline.activeTime = null;
                timeline.closedRigIds.clear();
            }
            return;
        }

        if (message.type === "keyframe") {
            // Compatibility with the original single-rig protocol.
            if (session.rigs.length !== 1) {
                throw new Error("Para animar dos rigs se requieren acciones joint sincronizadas.");
            }
            if (timeline.activeTime !== null || message.time <= timeline.lastTime) {
                throw new Error("Keyframe completo fuera de orden.");
            }
            const state = rigStates.get(message.rigId);
            if (!state) throw new Error("Keyframe para rig desconocido.");
            state.assembler.lastTime = message.time;
            state.assembler.previousJoints = message.joints;
            state.frameCount += 1;
            completedFrames += 1;
            timeline.lastTime = message.time;
            const frame = { ...message, type: "keyframe" };
            session.keyframes.set(`${message.rigId}:${message.time.toFixed(4)}`, frame);
            session.emit({
                type: "frame",
                rigId: message.rigId,
                rigName: state.rig.rigName,
                time: message.time,
                joints: message.joints,
                progress: getAnimationProgress(completedFrames, meta.keyframes),
                receivedFrames: state.frameCount
            });
            return;
        }

        if (message.type === "complete") {
            modelCompleted = true;
        }
    }

    await streamGeminiText({
        system: ANIMATION_SYSTEM,
        prompt: buildAnimationPrompt(session.description, session.rigs),
        signal: session.controller.signal,
        onText(chunk) {
            if (!session.firstModelChunkLogged) {
                session.firstModelChunkLogged = true;
                console.log(`[SESIÓN ${session.id}] Antigravity comenzó a enviar movimientos.`);
                session.emit({
                    type: "status",
                    status: "receiving_ai",
                    message: "La IA está moviendo los rigs y construyendo los clips…",
                    progress: 4
                });
            }
            buffer = consumeLines(buffer, chunk, processMessage);
        }
    });

    if (buffer.trim()) {
        const message = parseAnimationLine(buffer);
        if (message) processMessage(message);
    }

    ensureNoOpenFrames(rigStates, timeline);

    if (!meta || !modelCompleted) {
        throw new Error("La IA no envió el cierre complete de la animación.");
    }

    const frameCounts = [...rigStates.values()].map((state) => state.frameCount);
    const minFrames = Math.min(...frameCounts);
    const maxFrames = Math.max(...frameCounts);
    if (minFrames < 2 || minFrames !== maxFrames) {
        throw new Error("Los rigs no recibieron la misma cantidad de keyframes.");
    }
    if (timeline.lastTime < meta.duration * 0.95) {
        throw new Error("La animación no alcanzó el final de la duración solicitada.");
    }

    session.status = "complete";
    session.progress = 100;
    console.log(`[SESIÓN ${session.id}] Animación completa: ${minFrames} frames sincronizados por rig.`);
    session.emit({
        type: "complete",
        status: "complete",
        progress: 100,
        frameCount: minFrames,
        rigCount: session.rigs.length,
        duration: meta.duration,
        name: meta.name
    });
}
