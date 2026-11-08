import {
    ANIMATION_SYSTEM,
    MAX_DURATION_SECONDS,
    MIN_DURATION_SECONDS,
    MAX_PREVIEW_KEYFRAMES
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

export function parseAnimationLine(rawLine, stage) {
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
        if (stage !== "preview") return null;

        const duration = clampNumber(
            data.duration,
            MIN_DURATION_SECONDS,
            MAX_DURATION_SECONDS,
            "duration"
        );

        const previewFrames = Math.round(clampNumber(
            data.previewFrames,
            8,
            MAX_PREVIEW_KEYFRAMES,
            "previewFrames"
        ));

        return {
            type: "meta",
            name: String(data.name || "R6 AI Animation").slice(0, 80),
            duration,
            previewFrames,
            looped: Boolean(data.looped)
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

            const clean = {};
            for (const field of NUMBER_FIELDS) {
                const max = field === "x" || field === "y" || field === "z"
                    ? (jointName === "RootJoint" ? 2 : 0.25)
                    : 180;
                clean[field] = clampNumber(
                    pose[field] ?? 0,
                    -max,
                    max,
                    `${jointName}.${field}`
                );
            }
            joints[jointName] = clean;
        }

        return { type: "keyframe", time, joints };
    }

    if (data.type === "complete" && stage === "finish") {
        return { type: "complete" };
    }

    return null;
}

export function buildPreviewPrompt(description, rig) {
    return [
        "TAREA: crear el primer 80% de una animación R6 a partir de una descripción escrita.",
        "DESCRIPCIÓN DEL MOVIMIENTO:",
        description,
        "",
        "DATOS REALES DEL RIG SELECCIONADO:",
        JSON.stringify(rig),
        "",
        "REQUISITOS:",
        "- Planifica el movimiento completo antes de emitir los keyframes.",
        "- La animación final tendrá una duración entre 0.5 y 30 segundos.",
        "- El primer pase debe cubrir desde t=0 hasta aproximadamente el 80% de la duración.",
        "- Emite entre 8 y 32 keyframes para este primer pase, según la complejidad.",
        "- Los tiempos deben ser crecientes y representar momentos significativos, no fotogramas aleatorios.",
        "- El primer objeto debe ser: {\"type\":\"meta\",\"name\":\"...\",\"duration\":4,\"previewFrames\":16,\"looped\":false}",
        "- Después emite un objeto por línea: {\"type\":\"keyframe\",\"time\":0.25,\"joints\":{...}}",
        "- joints debe contener exactamente estas seis claves: RootJoint, Neck, Left Shoulder, Right Shoulder, Left Hip, Right Hip.",
        "- Cada articulación contiene x,y,z,rx,ry,rz numéricos.",
        "- Crea una pose inicial clara en t=0 y una pose que deje la acción preparada para terminar en el 80%.",
        "- No emitas el 20% final. Se generará después de la aprobación humana.",
        "- No devuelvas el objeto complete en esta fase.",
        "",
        "DEVUELVE ÚNICAMENTE NDJSON. UNA LÍNEA POR OBJETO. SIN MARKDOWN."
    ].join("\n");
}

export function buildFinishPrompt(description, rig, session) {
    const frames = [...session.keyframes.values()]
        .sort((a, b) => a.time - b.time);

    return [
        "CONTINÚA Y TERMINA la animación R6 que el usuario ya aprobó en su vista previa.",
        "No reinicies ni sustituyas el movimiento aprobado.",
        "DESCRIPCIÓN ORIGINAL:",
        description,
        "",
        "RIG R6:",
        JSON.stringify(rig),
        "",
        "KEYFRAMES APROBADOS HASTA AHORA:",
        JSON.stringify(frames),
        "",
        "INSTRUCCIONES:",
        "- Continúa desde el último tiempo existente hasta la duración completa.",
        "- Genera el 20% final con seguimiento, recuperación y una pose final coherente.",
        "- Conserva la intención, ritmo y estilo del 80% aprobado.",
        "- Puedes añadir ajustes muy pequeños a los últimos keyframes existentes solo si son necesarios para una transición suave, pero no cambies el sentido del movimiento aprobado.",
        "- Emite primero los nuevos keyframes con tiempos superiores al último keyframe aprobado.",
        "- Cada keyframe debe incluir las seis articulaciones y x,y,z,rx,ry,rz.",
        "- Termina con una línea: {\"type\":\"complete\"}.",
        "",
        "FORMATO NDJSON ÚNICAMENTE. SIN TEXTO EXPLICATIVO NI MARKDOWN."
    ].join("\n");
}

export function getPreviewProgress(frameCount, expectedFrames) {
    if (!expectedFrames) return 15;
    return Math.min(79, 15 + Math.floor((frameCount / expectedFrames) * 64));
}

