import "dotenv/config";

const MODEL = String(process.env.GEMINI_MODEL || "gemini-4-argon").trim();
const API_KEY = String(process.env.GEMINI_API_KEY || "").trim();
const THINKING_LEVEL = String(process.env.GEMINI_THINKING_LEVEL || "HIGH").toUpperCase();

function parseSseBlock(block) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

    if (!data || data === "[DONE]") return [];
    try {
        const payload = JSON.parse(data);
        const parts = payload?.candidates?.[0]?.content?.parts || [];
        return parts
            .filter((part) => typeof part.text === "string" && part.thought !== true)
            .map((part) => part.text);
    } catch {
        return [];
    }
}

export async function streamGeminiText({ system, prompt, onText, signal }) {
    if (!API_KEY) {
        throw new Error("Falta GEMINI_API_KEY. Configúrala en ia/.env; nunca la pongas en el plugin.");
    }

    if (!["LOW", "MEDIUM", "HIGH"].includes(THINKING_LEVEL)) {
        throw new Error("GEMINI_THINKING_LEVEL debe ser LOW, MEDIUM o HIGH para Gemini 4 Argon.");
    }

    const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:streamGenerateContent?alt=sse`;

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": API_KEY
        },
        body: JSON.stringify({
            systemInstruction: {
                parts: [{ text: system }]
            },
            contents: [{
                role: "user",
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                thinkingConfig: {
                    thinkingLevel: THINKING_LEVEL
                }
            }
        }),
        signal
    });

    if (!response.ok) {
        const detail = (await response.text()).slice(0, 1800);
        throw new Error(`Gemini API HTTP ${response.status}: ${detail}`);
    }

    if (!response.body) {
        throw new Error("Gemini no devolvió un flujo de respuesta.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";

        for (const block of blocks) {
            for (const text of parseSseBlock(block)) {
                onText(text);
            }
        }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
        for (const text of parseSseBlock(buffer)) onText(text);
    }
}
