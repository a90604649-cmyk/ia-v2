import { randomUUID } from "node:crypto";

const rawConsoleError = console.error.bind(console);
let consoleDiagnosticsInstalled = false;
const fatalHandlersInstalled = new Set();

const SECRET_KEY = /authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|cookie|imagebase64|dataurl|base64/i;

function redactText(value) {
	return String(value ?? "")
		.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
		.replace(/((?:NVIDIA|OMNIROUTE|OPENAI|API)[_-]?(?:API[_-]?)?KEY\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
		.replace(/(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
		.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "data:image/[REDACTED]")
		.slice(0, 5000);
}

function safeValue(value, key = "", depth = 0, seen = new WeakSet()) {
	if (SECRET_KEY.test(key)) return "[REDACTED]";
	if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value ?? null;
	if (typeof value === "string") return redactText(value);
	if (typeof value === "bigint") return String(value);
	if (typeof value === "function") return "[Function]";
	if (value instanceof Error) {
		return {
			name: String(value.name || "Error"),
			message: redactText(value.message || String(value)),
			code: value.code == null ? undefined : redactText(value.code),
			stack: value.stack ? redactText(value.stack).slice(0, 8000) : undefined
		};
	}
	if (depth >= 5) return "[MAX_DEPTH]";
	if (typeof value === "object") {
		if (seen.has(value)) return "[CIRCULAR]";
		seen.add(value);
		if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeValue(item, "", depth + 1, seen));
		const result = {};
		for (const [childKey, childValue] of Object.entries(value).slice(0, 40)) {
			result[childKey] = safeValue(childValue, childKey, depth + 1, seen);
		}
		return result;
	}
	return redactText(value);
}

function emitDiagnostic(level, service, stage, args) {
	const actualError = args.find((item) => item instanceof Error);
	const message = args.map((item) => {
		if (item instanceof Error) return `${item.name}: ${item.message}`;
		if (typeof item === "string") return item;
		try {
			return JSON.stringify(safeValue(item));
		} catch {
			return String(item);
		}
	}).join(" ").slice(0, 6000);
	const callsite = new Error("diagnostic callsite").stack;
	const event = {
		timestamp: new Date().toISOString(),
		level,
		service,
		stage,
		message: redactText(message),
		...(actualError ? { error: safeValue(actualError) } : {}),
		stack: redactText(actualError?.stack || callsite || "").slice(0, 8000)
	};
	rawConsoleError(`[DIAGNOSTIC_${level}] ${JSON.stringify(event)}`);
}

export function suppressRoutineLogs() {
	console.log = () => {};
}

export function installDiagnosticLogging(service) {
	suppressRoutineLogs();
	if (consoleDiagnosticsInstalled) return;
	consoleDiagnosticsInstalled = true;
	console.warn = (...args) => emitDiagnostic("WARN", service, "console.warn", args);
	console.error = (...args) => emitDiagnostic("ERROR", service, "console.error", args);
}

export function logError(service, stage, error, context = {}) {
	const normalized = error instanceof Error ? error : new Error(redactText(error));
	const event = {
		timestamp: new Date().toISOString(),
		level: "ERROR",
		service,
		stage,
		error: safeValue(normalized),
		context: safeValue(context)
	};
	rawConsoleError(`[DIAGNOSTIC_ERROR] ${JSON.stringify(event)}`);
}

export function requestIdMiddleware(req, res, next) {
	req.diagnosticId = randomUUID();
	res.setHeader("X-Request-ID", req.diagnosticId);
	next();
}

export function expressErrorMiddleware(service) {
	return (error, req, res, next) => {
		const status = Number(error?.status || error?.statusCode || 500);
		logError(service, "http.middleware", error, {
			requestId: req?.diagnosticId || null,
			method: req?.method || null,
			path: req?.path || req?.originalUrl || null,
			status,
			parserType: error?.type || null
		});
		if (res.headersSent) return next(error);
		const safeStatus = status === 413 ? 413 : (status >= 400 && status < 500 ? status : 500);
		const publicMessage = safeStatus === 413
			? "La petición supera el límite permitido."
			: safeStatus < 500
				? "La petición no es válida."
				: "Error interno del servidor.";
		return res.status(safeStatus).json({
			ok: false,
			error: publicMessage,
			requestId: req?.diagnosticId || null
		});
	};
}

export function installFatalErrorHandlers(service, onFatal) {
	if (fatalHandlersInstalled.has(service)) return;
	fatalHandlersInstalled.add(service);
	const stop = (stage, error) => {
		logError(service, stage, error);
		if (typeof onFatal === "function") {
			try {
				onFatal(error);
				return;
			} catch (shutdownError) {
				logError(service, "fatal.shutdown", shutdownError);
			}
		}
		process.exit(1);
	};
	process.on("uncaughtException", (error) => stop("process.uncaughtException", error));
	process.on("unhandledRejection", (reason) => {
		const error = reason instanceof Error ? reason : new Error(`Unhandled rejection: ${redactText(reason)}`);
		stop("process.unhandledRejection", error);
	});
}
