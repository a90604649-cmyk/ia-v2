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

export async function generatePreview(session) {
    session.status = "generating_preview";
    session.emit({ type: "status", status: session.status, progress: 5 });

    let buffer = "";
    let meta = null;
    let receivedFrames = 0;
    let lastTime = -1;

    await streamGeminiText({
        system: ANIMATION_SYSTEM,
        prompt: buildPreviewPrompt(session.description, session.rig),
        signal: session.controller.signal,
        onText(chunk) {
            buffer = consumeLines(buffer, chunk, "preview", (message) => {
                if (message.type === "meta") {
                    meta = message;
                    session.meta = message;
                    session.emit({ ...message, progress: 10 });
                    return;
                }

                if (message.type === "keyframe") {
                    if (!meta) {
                        throw new Error("El modelo emitió keyframes antes de meta.");
                    }
                    if (message.time <= lastTime) {
                        throw new Error("Los tiempos de los keyframes no son crecientes.");
                    }
                    if (message.time > meta.duration * 0.84) {
                        throw new Error("El primer pase debe detenerse cerca del 80% de la duración.");
                    }

                    lastTime = message.time;
                    receivedFrames += 1;
                    session.keyframes.set(message.time, message);
                    const progress = getPreviewProgress(receivedFrames, meta.previewFrames);
                    session.emit({
                        ...message,
                        progress,
                        receivedFrames,
                        expectedFrames: meta.previewFrames
                    });
                    session.progress = progress;
                }
            });
        }
    });

    if (buffer.trim()) {
        const message = parseAnimationLine(buffer, "preview");
        if (message?.type === "meta") {
            meta = message;
            session.meta = message;
            session.emit({ ...message, progress: 10 });
        } else if (message?.type === "keyframe") {
            if (message.time <= lastTime) throw new Error("Tiempo de keyframe repetido o fuera de orden.");
            lastTime = message.time;
            receivedFrames += 1;
            session.keyframes.set(message.time, message);
            session.emit({ ...message, progress: getPreviewProgress(receivedFrames, meta?.previewFrames) });
        }
    }

    if (!meta || receivedFrames < 4) {
        throw new Error("Gemini no generó suficientes keyframes válidos para la vista previa.");
    }

    session.meta = meta;
    session.progress = PREVIEW_PROGRESS;
    session.status = "awaiting_approval";
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
    session.emit({ type: "status", status: session.status, progress: 82 });

    let buffer = "";
    let lastTime = Math.max(...session.keyframes.keys());
    let addedFrames = 0;

    await streamGeminiText({
        system: ANIMATION_SYSTEM,
        prompt: buildFinishPrompt(
            session.description + (feedback ? `\nCAMBIOS SOLICITADOS: ${feedback}` : ""),
            session.rig,
            session
        ),
        signal: session.controller.signal,
        onText(chunk) {
            buffer = consumeLines(buffer, chunk, "finish", (message) => {
                if (message.type === "keyframe") {
                    if (message.time <= lastTime) {
                        throw new Error("El acabado debe continuar después del último keyframe aprobado.");
                    }
                    if (message.time > session.meta.duration + 0.03) {
                        throw new Error("El keyframe excede la duración de la animación.");
                    }

                    lastTime = message.time;
                    addedFrames += 1;
                    session.keyframes.set(message.time, message);
                    session.emit({
                        ...message,
                        progress: Math.min(99, 80 + addedFrames * 4)
                    });
                } else if (message.type === "complete") {
                    session.modelCompleted = true;
                }
            });
        }
    });

    if (buffer.trim()) {
        const message = parseAnimationLine(buffer, "finish");
        if (message?.type === "keyframe") {
            if (message.time <= lastTime || message.time > session.meta.duration + 0.03) {
                throw new Error("Keyframe final fuera de rango.");
            }
            session.keyframes.set(message.time, message);
            session.emit({ ...message, progress: 98 });
            addedFrames += 1;
        }
        if (message?.type === "complete") session.modelCompleted = true;
    }

    if (addedFrames < 1 || !session.modelCompleted) {
        throw new Error("Gemini no terminó la fase final de la animación.");
    }

    session.status = "complete";
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
