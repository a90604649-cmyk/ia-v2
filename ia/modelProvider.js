import "dotenv/config";

const API_KEY = String(process.env.GEMINI_API_KEY || "").trim();
const ANTIGRAVITY_AGENT = String(
    process.env.ANTIGRAVITY_AGENT || "antigravity-preview-latest"
).trim();

function parseSseBlock(block) {
    let eventName = "";
    const dataLines = [];

    for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }

    const data = dataLines.join("\n");
    if (!data || data === "[DONE]") return null;

    try {
        return { eventName, payload: JSON.parse(data) };
    } catch {
        return null;
    }
}

export async function streamGeminiText({ system, prompt, onText, signal }) {
    if (!API_KEY) {
        throw new Error("Falta GEMINI_API_KEY. Configúrala en ia/.env; nunca la pongas en el plugin.");
    }

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": API_KEY
        },
        body: JSON.stringify({
            agent: ANTIGRAVITY_AGENT,
            input: `${system}\n\nINSTRUCCIONES DE ESTA ANIMACIÓN:\n${prompt}`,
            environment: "remote",
            stream: true,
            agent_config: { type: "antigravity" }
        }),
        signal
    });

    if (!response.ok) {
        const detail = (await response.text()).slice(0, 2400);
        throw new Error(`Antigravity Interactions API HTTP ${response.status}: ${detail}`);
    }

    if (!response.body) {
        throw new Error("Antigravity no devolvió un flujo de respuesta.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const stepTypes = new Map();
    let buffer = "";
    let completed = false;
    let terminalError = null;

    const processBlock = (block) => {
        const parsed = parseSseBlock(block);
        if (!parsed) return;

        const { eventName, payload } = parsed;
        if (eventName === "step.start" && payload.step?.type) {
            stepTypes.set(payload.index, payload.step.type);
            return;
        }

        if (eventName === "step.delta") {
            const stepType = stepTypes.get(payload.index);
            // Never pass internal thought summaries into the animation protocol.
            if (
                stepType === "model_output" &&
                payload.delta?.type === "text" &&
                typeof payload.delta.text === "string"
            ) {
                onText(payload.delta.text);
            }
            return;
        }

        if (eventName === "interaction.completed") {
            const status = payload.interaction?.status;
            if (status === "completed") completed = true;
            else terminalError = new Error(
                `Antigravity terminó con estado "${status || "desconocido"}".`
            );
            return;
        }

        if (eventName === "interaction.failed" || eventName === "error") {
            terminalError = new Error(
                payload.error?.message || payload.message || "Antigravity informó un error durante la generación."
            );
        }
    };

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() || "";
            for (const block of blocks) processBlock(block);
        }

        buffer += decoder.decode();
        if (buffer.trim()) processBlock(buffer);
    } finally {
        reader.releaseLock();
    }

    if (terminalError) throw terminalError;
    if (!completed) {
        throw new Error("El flujo de Antigravity terminó sin el evento interaction.completed.");
    }
}
