import {
    MAX_ANIMATION_KEYFRAMES,
    MAX_DURATION_SECONDS,
    MIN_DURATION_SECONDS
} from "./animationConfig.js";
import { R6_JOINTS } from "./r6.js";

const NUMBER_FIELDS = ["x", "y", "z", "rx", "ry", "rz"];

function clampNumber(value, min, max, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
        throw new Error(`Valor inválido en ${label}: ${String(value)}`);
    }
    return number;
}

function readRigId(data) {
    const rigId = String(data.rigId || data.rig || "R1");
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(rigId)) {
        throw new Error(`Identificador de rig no válido: ${rigId}`);
    }
    return rigId;
}

function parsePose(pose, jointName) {
    if (!pose || typeof pose !== "object") {
        throw new Error(`Acción de ${jointName} sin objeto pose.`);
    }

    const clean = {};
    for (const field of NUMBER_FIELDS) {
        const max = field === "x" || field === "y" || field === "z"
            ? (jointName === "RootJoint" ? 4 : 0.25)
            : 180;
        clean[field] = clampNumber(
            pose[field] ?? 0,
            -max,
            max,
            `${jointName}.${field}`
        );
    }
    return clean;
}

export function parseAnimationLine(rawLine) {
    const line = String(rawLine || "").trim();
    if (!line || line.startsWith("```")) return null;

    let data;
    try {
        data = JSON.parse(line);
    } catch {
        return null;
    }

    if (!data || typeof data !== "object" || typeof data.type !== "string") {
        return null;
    }

    if (data.type === "meta") {
        const duration = clampNumber(
            data.duration,
            MIN_DURATION_SECONDS,
            MAX_DURATION_SECONDS,
            "duration"
        );
        const keyframes = Math.round(clampNumber(
            data.keyframes ?? data.previewFrames ?? 24,
            2,
            MAX_ANIMATION_KEYFRAMES,
            "keyframes"
        ));

        return {
            type: "meta",
            name: String(data.name || "R6_AI_Animation").slice(0, 80),
            duration,
            keyframes,
            fps: Math.round(clampNumber(data.fps ?? 30, 12, 120, "fps")),
            looped: Boolean(data.looped)
        };
    }

    if (data.type === "joint") {
        const time = clampNumber(data.time, 0, MAX_DURATION_SECONDS, "time");
        const joint = String(data.joint || "");
        if (!R6_JOINTS.includes(joint)) {
            throw new Error(`Articulación R6 no válida: ${joint}`);
        }
        return {
            type: "joint",
            time,
            rigId: readRigId(data),
            joint,
            pose: parsePose(data.pose, joint)
        };
    }

    if (data.type === "frame") {
        return {
            type: "frame",
            time: clampNumber(data.time, 0, MAX_DURATION_SECONDS, "time"),
            rigId: readRigId(data)
        };
    }

    if (data.type === "keyframe") {
        const time = clampNumber(data.time, 0, MAX_DURATION_SECONDS, "time");
        if (!data.joints || typeof data.joints !== "object") {
            throw new Error("Keyframe sin objeto joints.");
        }
        const joints = {};
        for (const jointName of R6_JOINTS) {
            const pose = data.joints[jointName];
            if (!pose || typeof pose !== "object") {
                throw new Error(`Keyframe incompleto: falta ${jointName}.`);
            }
            joints[jointName] = parsePose(pose, jointName);
        }
        return { type: "keyframe", time, rigId: readRigId(data), joints };
    }

    if (data.type === "complete") {
        return { type: "complete" };
    }

    return null;
}

export function buildAnimationPrompt(description, rigs) {
    const rigList = Array.isArray(rigs) ? rigs : [rigs];
    const rigSummary = rigList.map((rig, index) => ({
        rigId: rig.rigId || `R${index + 1}`,
        rigName: rig.rigName,
        rigType: rig.rigType,
        worldPosition: rig.worldPosition,
        worldPivot: rig.worldPivot,
        parts: rig.parts,
        joints: rig.joints
    }));

    return [
        "TAREA: crear una animación R6 completa, de principio a fin, según la descripción.",
        "DESCRIPCIÓN DEL MOVIMIENTO:",
        description,
        "",
        "RIGS SELECCIONADOS:",
        JSON.stringify(rigSummary),
        "",
        "FORMATO OBLIGATORIO:",
        "- La primera línea es un meta: {\"type\":\"meta\",\"name\":\"Nombre\",\"duration\":4,\"keyframes\":24,\"fps\":30,\"looped\":false}.",
        "- Después transmite acciones incrementales por articulación, no esperes a terminar toda la animación.",
        "- Una acción tiene este formato: {\"type\":\"joint\",\"time\":0.25,\"rigId\":\"R1\",\"joint\":\"Right Shoulder\",\"pose\":{\"x\":0,\"y\":0,\"z\":0,\"rx\":0,\"ry\":0,\"rz\":-45}}.",
        "- Cierra las acciones de cada rig en cada tiempo con: {\"type\":\"frame\",\"time\":0.25,\"rigId\":\"R1\"}.",
        "- Los rigId válidos son exactamente los indicados arriba. No inventes otros.",
        "- Los tiempos deben ser crecientes. Cada rig debe cerrar un frame para el mismo tiempo antes de empezar el siguiente tiempo.",
        "- En cada tiempo, primero emite las acciones joint de R1 y su frame; luego las acciones joint de R2 y su frame (si existe R2).",
        "- En el primer tiempo t=0, emite las seis articulaciones para cada rig.",
        "- En los tiempos siguientes puedes emitir solo las articulaciones que cambien; las demás conservan la pose anterior.",
        "- Todos los rigs comparten los mismos tiempos. No animes un rig completo y después el otro: diseña sus movimientos como una sola escena coordinada.",
        "- Si hay dos rigs, interpreta sus papeles según la descripción (por ejemplo, uno entrega algo y el otro lo recibe, se saludan, caminan juntos o interactúan). Coordina miradas, distancias, gestos y reacciones.",
        "- Usa worldPosition y worldPivot para entender dónde empieza cada Dummy y mantener coherentes las distancias y direcciones entre ellos.",
        "- Usa las seis articulaciones R6 exactas: RootJoint, Neck, Left Shoulder, Right Shoulder, Left Hip, Right Hip.",
        "- Cada pose contiene x,y,z,rx,ry,rz numéricos.",
        "- Duración total entre 0.5 y 30 segundos. Distribuye keyframes durante toda la duración.",
        "- Incluye anticipación, acción, seguimiento y recuperación cuando proceda; termina con una pose final completa y coherente.",
        "- Emite el último frame en el tiempo de duración o muy cerca de él.",
        "- No hay checkpoint ni pausa al 80%. Genera el 100% de la animación en esta misma ejecución.",
        "- Termina exactamente con una línea: {\"type\":\"complete\"}.",
        "",
        "DEVUELVE ÚNICAMENTE NDJSON, UNA LÍNEA POR OBJETO. SIN MARKDOWN NI TEXTO EXPLICATIVO."
    ].join("\n");
}

export function getAnimationProgress(frameCount, expectedFrames) {
    if (!expectedFrames) return 5;
    return Math.min(99, 5 + Math.floor((frameCount / expectedFrames) * 94));
}
