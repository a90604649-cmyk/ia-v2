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

    if (data.type === "joint") {
        const time = clampNumber(data.time, 0, MAX_DURATION_SECONDS, "time");
        const joint = String(data.joint || "");
        if (!R6_JOINTS.includes(joint)) {
            throw new Error(`Articulación R6 no válida: ${joint}`);
        }
        if (!data.pose || typeof data.pose !== "object") {
            throw new Error(`Acción de ${joint} sin objeto pose.`);
        }

        const pose = {};
        for (const field of NUMBER_FIELDS) {
            const max = field === "x" || field === "y" || field === "z"
                ? (joint === "RootJoint" ? 4 : 0.25)
                : 180;
            pose[field] = clampNumber(
                data.pose[field] ?? 0,
                -max,
                max,
                `${joint}.${field}`
            );
        }

        return { type: "joint", time, joint, pose };
    }

    if (data.type === "frame") {
        return {
            type: "frame",
            time: clampNumber(data.time, 0, MAX_DURATION_SECONDS, "time")
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
                    ? (jointName === "RootJoint" ? 4 : 0.25)
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
        "- Trabaja de forma incremental: emite la primera acción válida en cuanto la decidas; no esperes a tener toda la animación escrita.",
        "- La animación final tendrá una duración entre 0.5 y 30 segundos.",
        "- El primer pase debe cubrir desde t=0 hasta aproximadamente el 80% de la duración.",
        "- Emite entre 8 y 32 keyframes para este primer pase, según la complejidad.",
        "- Los tiempos deben ser crecientes y representar momentos significativos, no fotogramas aleatorios.",
        "- El primer objeto debe ser: {\"type\":\"meta\",\"name\":\"...\",\"duration\":4,\"previewFrames\":16,\"looped\":false}",
        "- No uses objetos type keyframe ni agrupes varias articulaciones en un mismo objeto; usa solamente acciones type joint y cierres type frame.",
        "- Para el primer tiempo (t=0), emite seis acciones joint, una por articulación, para definir la pose inicial completa.",
        "- Para cada tiempo posterior, emite una acción joint separada por cada articulación que cambie; no emitas articulaciones que mantengan exactamente la pose anterior.",
        "- Una acción tiene este formato: {\"type\":\"joint\",\"time\":0.25,\"joint\":\"Right Shoulder\",\"pose\":{\"x\":0,\"y\":0,\"z\":0,\"rx\":0,\"ry\":0,\"rz\":-45}}.",
        "- Inmediatamente después de las acciones de cada tiempo, emite {\"type\":\"frame\",\"time\":0.25} para cerrar y guardar ese keyframe. No cambies de tiempo antes de cerrarlo.",
        "- Usa exactamente estos nombres de articulación: RootJoint, Neck, Left Shoulder, Right Shoulder, Left Hip, Right Hip.",
        "- Cada acción joint debe contener x,y,z,rx,ry,rz numéricos.",
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
        "- Emite acciones joint incrementales, usando tiempos superiores al último keyframe aprobado.",
        "- No uses objetos type keyframe ni agrupes varias articulaciones en un mismo objeto; usa solamente acciones type joint y cierres type frame.",
        "- Para cada tiempo, emite una acción joint por cada articulación que cambie respecto al último frame y después cierra el tiempo con {\"type\":\"frame\",\"time\":...}. Las articulaciones no mencionadas conservan su pose anterior.",
        "- Termina con una línea: {\"type\":\"complete\"}.",
        "",
        "FORMATO NDJSON ÚNICAMENTE. SIN TEXTO EXPLICATIVO NI MARKDOWN."
    ].join("\n");
}

export function getPreviewProgress(frameCount, expectedFrames) {
    if (!expectedFrames) return 15;
    return Math.min(79, 15 + Math.floor((frameCount / expectedFrames) * 64));
}

