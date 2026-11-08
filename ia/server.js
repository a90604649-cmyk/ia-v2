import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { validateRigSnapshots } from "./r6.js";
import { generateAnimation } from "./animation.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Math.max(1, Number(process.env.PORT || 3000));
const HOST = process.env.HOST || "127.0.0.1";
const sessions = new Map();
const MAX_EVENTS_PER_SESSION = 5000;

function emit(session, event) {
    session.sequence += 1;
    session.events.push({ sequence: session.sequence, ...event });
    if (session.events.length > MAX_EVENTS_PER_SESSION) {
        session.events.splice(0, session.events.length - MAX_EVENTS_PER_SESSION);
    }
}

function failSession(session, error) {
    if (session.status === "cancelled") return;
    session.status = "error";
    console.error(`[SESIÓN ${session.id}] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    session.error = error instanceof Error ? error.message : String(error);
    emit(session, { type: "error", status: "error", error: session.error });
}

function getSession(req, res) {
    const session = sessions.get(String(req.params.id || ""));
    if (!session) {
        res.status(404).json({ ok: false, error: "Sesión no encontrada." });
        return null;
    }
    return session;
}

app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "R6 Live Animator",
        provider: "Antigravity Interactions API",
        agent: process.env.ANTIGRAVITY_AGENT || "antigravity-preview-latest",
        apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY)
    });
});

app.post("/api/animations", async (req, res) => {
    try {
        const description = String(req.body?.description || "").trim();
        if (description.length < 5 || description.length > 4000) {
            return res.status(400).json({
                ok: false,
                error: "Describe la animación con entre 5 y 4000 caracteres."
            });
        }

        const inputRigs = Array.isArray(req.body?.rigs) ? req.body.rigs : [req.body?.rig];
        const rigs = validateRigSnapshots(inputRigs);
        const id = randomUUID();

        const session = {
            id,
            description,
            rigs,
            rig: rigs[0],
            status: "queued",
            progress: 0,
            sequence: 0,
            events: [],
            keyframes: new Map(),
            meta: null,
            controller: new AbortController(),
            createdAt: Date.now()
        };

        session.emit = (event) => emit(session, event);
        sessions.set(id, session);
        console.log(`[SESIÓN ${id}] Nueva animación R6 para ${rigs.length} rig(s): "${description.slice(0, 120)}"`);
        emit(session, { type: "status", status: "queued", progress: 0 });

        generateAnimation(session).catch((error) => failSession(session, error));

        return res.status(202).json({
            ok: true,
            sessionId: id,
            status: session.status
        });
    } catch (error) {
        return res.status(400).json({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        });
    }
});

app.get("/api/animations/:id/events", (req, res) => {
    const session = getSession(req, res);
    if (!session) return;

    const after = Math.max(0, Number(req.query.after) || 0);
    const events = session.events.filter((event) => event.sequence > after);
    if (events.length) console.log(`[SESIÓN ${session.id}] Plugin recibió ${events.length} evento(s); estado=${session.status}; progreso=${session.progress}%`);

    res.set("Cache-Control", "no-store");
    res.json({
        ok: true,
        sessionId: session.id,
        status: session.status,
        progress: session.progress,
        latestSequence: session.sequence,
        events
    });
});

app.post("/api/animations/:id/cancel", (req, res) => {
    const session = getSession(req, res);
    if (!session) return;

    console.log(`[SESIÓN ${session.id}] Usuario canceló la animación.`);
    session.status = "cancelled";
    session.controller.abort();
    emit(session, { type: "cancelled", status: "cancelled" });
    res.json({ ok: true, status: "cancelled" });
});

const server = app.listen(PORT, HOST, () => {
    console.log(`R6 Live Animator escuchando en http://${HOST}:${PORT}`);
    console.log(`Agente: ${process.env.ANTIGRAVITY_AGENT || "antigravity-preview-latest"} | Proveedor: Antigravity Interactions API`);
});

function close() {
    server.close(() => process.exit(0));
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
