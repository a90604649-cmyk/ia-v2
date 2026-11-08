import { streamGeminiText } from "./modelProvider.js";
import {
    ANIMATION_SYSTEM,
    PREVIEW_PROGRESS
} from "./animationConfig.js";
import {
    parseAnimationLine,
    buildPreviewPrompt,
    buildFinishPrompt,
    getPreviewProgress
} from "./animationCore.js";
import { R6_JOINTS } from "./r6.js";

function consumeLines(buffer, chunk, stage, onMessage) {
    const combined = buffer + chunk;
    const lines = combined.split(/\r?\n/);
    const remainder = lines.pop() || "";

    for (const line of lines) {
        const message = parseAnimationLine(line, stage);
        if (message) onMessage(message);
    }

    return remainder;
}

function createFrameAssembler(previousJoints = null) {
    const neutralPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
    const startingJoints = {};
    for (const name of R6_JOINTS) {
        startingJoints[name] = { ...(previousJoints?.[name] || neutralPose) };
    }

    return {
        lastTime: -1,
        activeTime: null,
        pendingJoints: {},
        touched: new Set(),
        previousJoints: startingJoints
    };
}

function acceptJointAction(state, message) {
    if (state.activeTime === null) {
        if (message.time <= state.lastTime) {
            throw new Error("Los tiempos de las acciones deben ser crecientes.");
        }
        state.activeTime = message.time;
    } else if (Math.abs(message.time - state.activeTime) > 0.0005) {
        throw new Error("La IA cambió de tiempo antes de cerrar el frame anterior.");
    }

    if (state.touched.has(message.joint)) {
        throw new Error(`La IA repitió ${message.joint} en el mismo tiempo.`);
    }

    state.touched.add(message.joint);
    state.pendingJoints[message.joint] = message.pose;
    return state.touched.size;
}

function closeFrame(state, message) {
    if (state.activeTime === null) {
        throw new Error("La IA intentó cerrar un frame sin acciones de articulación.");
    }
    if (Math.abs(message.time - state.activeTime) > 0.0005) {
        throw new Error("El cierre de frame no coincide con el tiempo de sus acciones.");
    }
    if (state.touched.size === 0) {
        throw new Error("El frame no contiene acciones.");
    }
    if (state.lastTime < 0 && state.touched.size !== R6_JOINTS.length) {
        throw new Error("La pose inicial debe definir las seis articulaciones R6.");
    }

    const joints = { ...state.previousJoints, ...state.pendingJoints };
    const frame = {
        type: "keyframe",
        time: state.activeTime,
        joints
    };

    state.lastTime = state.activeTime;
    state.previousJoints = joints;
    state.activeTime = null;
    state.pendingJoints = {};
    state.touched = new Set();

    return frame;
}

function ensureNoOpenFrame(state) {
    if (state.activeTime !== null) {
        throw new Error("La generación terminó antes de cerrar el último frame.");
    }
}

export async function generatePreview(session) {
    session.status = "generating_preview";
    console.log(`[SESIÓN ${session.id}] Fase 1/2: conectando con Antigravity para generar la vista previa.`);
    session.emit({ type: "status", status: "connecting_ai", message: "Conectando con Antigravity…", progress: 5 });
    session.emit({ type: "status", status: session.status, progress: 5 });

    let buffer = "";
    let meta = null;
    let receivedFrames = 0;
    const assembler = createFrameAssembler();

    function processMessage(message) {
        if (message.type === "meta") {
            meta = message;
            session.meta = message;
            console.log(`[SESIÓN ${session.id}] Metadatos recibidos: "${message.name}", duración ${message.duration}s, objetivo ${message.previewFrames} keyframes.`);
            session.emit({ ...message, progress: 10 });
            return;
        }

        if (!meta) {
            throw new Error("La IA emitió acciones antes de los metadatos iniciales.");
        }

        if (message.type === "joint") {
            if (message.time > meta.duration * 0.84) {
                throw new Error("La vista previa no debe superar aproximadamente el 80% de la duración.");
            }
            const jointCount = acceptJointAction(assembler, message);
            const progress = getPreviewProgress(
                receivedFrames + Math.min(0.99, jointCount / R6_JOINTS.length),
                meta.previewFrames
            );
            session.progress = progress;
            session.emit({
                ...message,
                progress,
                frameJointCount: jointCount,
                frameJointTotal: R6_JOINTS.length
            });
            console.log(`[SESIÓN ${session.id}] Acción en directo: ${message.joint} en t=${message.time}s.`);
            return;
        }

        if (message.type === "frame") {
            if (message.time > meta.duration * 0.84) {
                throw new Error("El frame de vista previa excede el límite del 80%.");
            }
            const frame = closeFrame(assembler, message);
            receivedFrames += 1;
            session.keyframes.set(frame.time, frame);
            const progress = getPreviewProgress(receivedFrames, meta.previewFrames);
            session.progress = progress;
            session.emit({
                type: "frame",
                time: frame.time,
                joints: frame.joints,
                progress,
                receivedFrames,
                expectedFrames: meta.previewFrames
            });
            console.log(`[SESIÓN ${session.id}] Frame ${receivedFrames}/${meta.previewFrames} cerrado en t=${frame.time}s.`);
            return;
        }

        // Compatibilidad con modelos que todavía emitan keyframes completos.
        if (message.type === "keyframe") {
            ensureNoOpenFrame(assembler);
            if (message.time <= assembler.lastTime || message.time > meta.duration * 0.84) {
                throw new Error("Keyframe de vista previa fuera de orden o del rango permitido.");
            }
            assembler.lastTime = message.time;
            assembler.previousJoints = message.joints;
            receivedFrames += 1;
            session.keyframes.set(message.time, message);
            const progress = getPreviewProgress(receivedFrames, meta.previewFrames);
            session.progress = progress;
            session.emit({ type: "frame", ...message, progress, receivedFrames, expectedFrames: meta.previewFrames });
        }
    }

    await streamGeminiText({
        system: ANIMATION_SYSTEM,
        prompt: buildPreviewPrompt(session.description, session.rig),
        signal: session.controller.signal,
        onText(chunk) {
            if (!session.firstModelChunkLogged) {
                session.firstModelChunkLogged = true;
                console.log(`[SESIÓN ${session.id}] Antigravity comenzó a enviar texto.`);
                session.emit({ type: "status", status: "receiving_ai", message: "La IA está enviando movimientos al Dummy…", progress: 8 });
            }
            buffer = consumeLines(buffer, chunk, "preview", processMessage);
        }
    });

    if (buffer.trim()) {
        const message = parseAnimationLine(buffer, "preview");
        if (message) processMessage(message);
    }

    ensureNoOpenFrame(assembler);

    if (!meta || receivedFrames < Math.ceil(meta.previewFrames * 0.8)) {
        throw new Error("La IA no generó al menos el 80% de los frames previstos para la vista previa.");
    }
    if (assembler.lastTime < meta.duration * 0.65) {
        throw new Error("La vista previa no cubrió suficiente duración del movimiento para solicitar aprobación.");
    }

    session.meta = meta;
    session.progress = PREVIEW_PROGRESS;
    session.status = "awaiting_approval";
    console.log(`[SESIÓN ${session.id}] Vista previa lista: ${session.keyframes.size} keyframes. Esperando aprobación.`);
    session.emit({
        type: "checkpoint",
        status: session.status,
        progress: PREVIEW_PROGRESS,
        frameCount: session.keyframes.size,
        duration: meta.duration
    });
}

export async function generateFinish(session, feedback = "") {
    session.status = "finishing";
    console.log(`[SESIÓN ${session.id}] Fase 2/2: generando el tramo final.`);
    session.emit({ type: "status", status: session.status, progress: 82 });

    let buffer = "";
    const existingFrames = [...session.keyframes.values()].sort((a, b) => a.time - b.time);
    const lastApprovedFrame = existingFrames[existingFrames.length - 1];
    const assembler = createFrameAssembler(lastApprovedFrame?.joints);
    assembler.lastTime = lastApprovedFrame?.time ?? -1;
    let addedFrames = 0;

    function processMessage(message) {
        if (message.type === "joint") {
            if (message.time > session.meta.duration + 0.03) {
                throw new Error("La acción de articulación excede la duración de la animación.");
            }
            const jointCount = acceptJointAction(assembler, message);
            const progress = Math.min(99, 80 + Math.floor((addedFrames + jointCount / R6_JOINTS.length) * 4));
            session.progress = progress;
            session.emit({
                ...message,
                progress,
                frameJointCount: jointCount,
                frameJointTotal: R6_JOINTS.length
            });
            console.log(`[SESIÓN ${session.id}] Acción final en directo: ${message.joint} en t=${message.time}s.`);
            return;
        }

        if (message.type === "frame") {
            const frame = closeFrame(assembler, message);
            if (frame.time > session.meta.duration + 0.03) {
                throw new Error("El keyframe final excede la duración de la animación.");
            }
            addedFrames += 1;
            session.keyframes.set(frame.time, frame);
            const progress = Math.min(99, 80 + addedFrames * 4);
            session.progress = progress;
            session.emit({
                type: "frame",
                time: frame.time,
                joints: frame.joints,
                progress,
                receivedFrames: addedFrames
            });
            console.log(`[SESIÓN ${session.id}] Frame final ${addedFrames} cerrado en t=${frame.time}s.`);
            return;
        }

        if (message.type === "keyframe") {
            ensureNoOpenFrame(assembler);
            if (message.time <= assembler.lastTime || message.time > session.meta.duration + 0.03) {
                throw new Error("Keyframe final fuera de rango.");
            }
            assembler.lastTime = message.time;
            assembler.previousJoints = message.joints;
            session.keyframes.set(message.time, message);
            addedFrames += 1;
            session.emit({ type: "frame", ...message, progress: Math.min(99, 80 + addedFrames * 4) });
            return;
        }

        if (message.type === "complete") {
            session.modelCompleted = true;
        }
    }

    await streamGeminiText({
        system: ANIMATION_SYSTEM,
        prompt: buildFinishPrompt(
            session.description + (feedback ? `\nCAMBIOS SOLICITADOS: ${feedback}` : ""),
            session.rig,
            session
        ),
        signal: session.controller.signal,
        onText(chunk) {
            buffer = consumeLines(buffer, chunk, "finish", processMessage);
        }
    });

    if (buffer.trim()) {
        const message = parseAnimationLine(buffer, "finish");
        if (message) processMessage(message);
    }

    ensureNoOpenFrame(assembler);

    if (addedFrames < 1 || !session.modelCompleted) {
        throw new Error("La IA no terminó la fase final de la animación.");
    }
    if (assembler.lastTime < session.meta.duration * 0.97) {
        throw new Error("La fase final no alcanzó el final de la duración planificada.");
    }

    session.status = "complete";
    console.log(`[SESIÓN ${session.id}] Animación completa: ${session.keyframes.size} keyframes.`);
    session.progress = 100;
    session.emit({
        type: "complete",
        status: session.status,
        progress: 100,
        frameCount: session.keyframes.size,
        duration: session.meta.duration,
        name: session.meta.name
    });
}
