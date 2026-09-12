
import "dotenv/config";
import express from "express";

const app = express();

const PORT = Number(
    process.env.PROJECT_CONTEXT_PORT || 3001
);

const HOST =
    process.env.PROJECT_CONTEXT_HOST || "0.0.0.0";

const MAX_SOURCE_CHARS = 350000;
const MAX_SCRIPTS = 1000;
const MAX_OBJECTS = 5000;

const MAX_DIRECT_SCRIPTS = 40;
const MAX_RELATED_SCRIPTS = 60;
const MAX_OBJECTS_WITH_MATCHES = 250;
const MAX_OBJECTS_WITHOUT_MATCHES = 150;

app.use(
    express.json({
        limit: "20mb"
    })
);

const scripts = new Map();
const objects = new Map();

let lastScanAt = 0;

const SCRIPT_CLASSES = new Set([
    "Script",
    "LocalScript",
    "ModuleScript"
]);

function shouldIgnore(text) {
    const value = String(text || "").toLowerCase();

    return (
        value.includes("geminibridgeplugin") ||
        value.includes("roblox ai bridge") ||
        value.includes("projectcontext") ||
        value.includes("project context")
    );
}

function normalizePath(path) {
    return String(path || "")
        .trim()
        .replaceAll("\\", "/")
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/")
        .replace(/\/+$/, "");
}

function normalizeScript(script) {
    if (!script || typeof script !== "object") {
        return null;
    }

    const className = String(
        script.className || ""
    ).trim();

    if (!SCRIPT_CLASSES.has(className)) {
        return null;
    }

    const name = String(
        script.name || ""
    ).trim();

    const path = normalizePath(
        script.path
    );

    const source =
        typeof script.source === "string"
            ? script.source
            : String(script.source || "");

    if (!name || !path) {
        return null;
    }

    if (source.length > MAX_SOURCE_CHARS) {
        return null;
    }

    if (
        path.includes("..") ||
        shouldIgnore(`${name} ${path}`)
    ) {
        return null;
    }

    return {
        className,
        name,
        path,
        source,
        size: source.length,
        hasSource: source.trim().length > 0
    };
}

function normalizeObject(object) {
    if (!object || typeof object !== "object") {
        return null;
    }

    /*
     * Não existe mais uma lista fixa de classes permitidas.
     *
     * O servidor aceita qualquer classe enviada pelo plugin.
     * Isso mantém o Project Context independente do tipo
     * de sistema ou objeto existente no projeto.
     */
    const className = String(
        object.className || ""
    ).trim();

    const name = String(
        object.name || ""
    ).trim();

    const path = normalizePath(
        object.path
    );

    if (
        !className ||
        !name ||
        !path ||
        path.includes("..") ||
        shouldIgnore(`${name} ${path}`)
    ) {
        return null;
    }

    return {
        className,
        name,
        path
    };
}

function tokenize(text) {
    return String(text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-z0-9_]+/i)
        .filter(
            (token) => token.length >= 2
        );
}

/*
 * Palavras que normalmente descrevem a ação do usuário,
 * e não identificam uma parte específica do projeto.
 *
 * IMPORTANTE:
 * Isso não define nenhum sistema.
 * Apenas evita que palavras como "modifica",
 * "crea" ou "corrige" ganen peso como nombres
 * de scripts.
 */
const ACTION_WORDS = new Set([
    "hacer",
    "haz",
    "crear",
    "crea",
    "creame",
    "crealo",
    "crear",
    "modifica",
    "modificar",
    "modifica",
    "cambia",
    "cambiar",
    "cambiale",
    "corrige",
    "corregir",
    "corrigelo",
    "arregla",
    "arreglar",
    "mejora",
    "mejorar",
    "optimiza",
    "optimizar",
    "elimina",
    "eliminar",
    "borra",
    "borrar",
    "agrega",
    "agregar",
    "añade",
    "anadir",
    "cambia",
    "quita",
    "quitar",
    "reemplaza",
    "reemplazar",
    "actualiza",
    "actualizar",
    "edita",
    "editar",
    "ajusta",
    "ajustar",
    "configura",
    "configurar",
    "revisa",
    "revisar",
    "arreglar",
    "soluciona",
    "solucionar",
    "fix",
    "create",
    "make",
    "modify",
    "change",
    "edit",
    "fixes",
    "fixing",
    "update",
    "updated",
    "remove",
    "delete",
    "add",
    "build",
    "improve",
    "optimize",
    "optimize"
]);

function extractQueryTerms(query) {
    return [
        ...new Set(
            tokenize(query).filter(
                (token) =>
                    !ACTION_WORDS.has(token)
            )
        )
    ];
}

function countOccurrences(text, term) {
    if (!text || !term) {
        return 0;
    }

    let count = 0;
    let start = 0;

    while (true) {
        const index = text.indexOf(
            term,
            start
        );

        if (index === -1) {
            break;
        }

        count++;

        start =
            index +
            Math.max(term.length, 1);
    }

    return count;
}

function scoreScript(
    script,
    queryTerms
) {
    const nameLower =
        script.name.toLowerCase();

    const pathLower =
        script.path.toLowerCase();

    const sourceLower =
        script.source.toLowerCase();

    const nameTokens =
        tokenize(script.name);

    const pathTokens =
        tokenize(script.path);

    let score = 0;

    const signals = [];

    for (const term of queryTerms) {
        /*
         * Coincidencia exacta en el nombre.
         */
        if (
            nameTokens.includes(term)
        ) {
            score += 100;

            signals.push(
                `nombre:${term}`
            );
        }

        /*
         * Coincidencia exacta en la ruta.
         */
        if (
            pathTokens.includes(term)
        ) {
            score += 50;

            signals.push(
                `ruta:${term}`
            );
        }

        /*
         * Coincidencia parcial en el nombre.
         */
        if (
            nameLower.includes(term) &&
            !nameTokens.includes(term)
        ) {
            score += 40;

            signals.push(
                `nombre-parcial:${term}`
            );
        }

        /*
         * Coincidencia parcial en la ruta.
         */
        if (
            pathLower.includes(term) &&
            !pathTokens.includes(term)
        ) {
            score += 25;

            signals.push(
                `ruta-parcial:${term}`
            );
        }

        /*
         * Coincidencias dentro del código.
         */
        const sourceOccurrences =
            countOccurrences(
                sourceLower,
                term
            );

        if (
            sourceOccurrences > 0
        ) {
            score += Math.min(
                sourceOccurrences * 5,
                60
            );

            signals.push(
                `codigo:${term}`
            );
        }
    }

    /*
     * Tener código real es ligeramente preferible
     * a un script vacío, pero no se favorece ningún
     * tipo de sistema.
     */
    if (script.hasSource) {
        score += 2;
    }

    return {
        score,
        signals: [
            ...new Set(signals)
        ]
    };
}

function scoreObject(
    object,
    queryTerms
) {
    const nameTokens =
        tokenize(object.name);

    const pathTokens =
        tokenize(object.path);

    const nameLower =
        object.name.toLowerCase();

    const pathLower =
        object.path.toLowerCase();

    let score = 0;

    const signals = [];

    for (const term of queryTerms) {
        if (
            nameTokens.includes(term)
        ) {
            score += 80;

            signals.push(
                `nombre:${term}`
            );
        }

        if (
            pathTokens.includes(term)
        ) {
            score += 45;

            signals.push(
                `ruta:${term}`
            );
        }

        if (
            nameLower.includes(term) &&
            !nameTokens.includes(term)
        ) {
            score += 30;

            signals.push(
                `nombre-parcial:${term}`
            );
        }

        if (
            pathLower.includes(term) &&
            !pathTokens.includes(term)
        ) {
            score += 20;

            signals.push(
                `ruta-parcial:${term}`
            );
        }
    }

    return {
        score,
        signals: [
            ...new Set(signals)
        ]
    };
}

function buildManifest() {
    return Array.from(
        scripts.values()
    )
        .map((script) => ({
            className:
                script.className,

            name:
                script.name,

            path:
                script.path,

            size:
                script.size,

            hasSource:
                script.hasSource
        }))
        .sort((a, b) =>
            `${a.path}/${a.name}`.localeCompare(
                `${b.path}/${b.name}`
            )
        );
}

function buildObjects() {
    return Array.from(
        objects.values()
    )
        .map((object) => ({
            className:
                object.className,

            name:
                object.name,

            path:
                object.path
        }))
        .sort((a, b) =>
            `${a.path}/${a.name}`.localeCompare(
                `${b.path}/${b.name}`
            )
        );
}

function scriptKey(script) {
    return (
        `${script.path}/${script.name}`
    ).toLowerCase();
}

function objectKey(object) {
    return (
        `${object.path}/${object.name}`
    ).toLowerCase();
}

function selectRelevantScripts(
    query
) {
    const queryTerms =
        extractQueryTerms(query);

    /*
     * Ranking completamente basado en la petición.
     *
     * No existen categorías predefinidas.
     */
    const rankedScripts =
        Array.from(
            scripts.values()
        )
            .map((script) => {
                const scored =
                    scoreScript(
                        script,
                        queryTerms
                    );

                return {
                    script,
                    score:
                        scored.score,
                    signals:
                        scored.signals
                };
            })
            .sort((a, b) =>
                b.score - a.score ||
                `${a.script.path}/${a.script.name}`.localeCompare(
                    `${b.script.path}/${b.script.name}`
                )
            );

    const selected = [];
    const selectedKeys =
        new Set();

    function addCandidate(
        candidate
    ) {
        const key =
            scriptKey(
                candidate.script
            );

        if (
            selectedKeys.has(key)
        ) {
            return false;
        }

        selected.push(
            candidate
        );

        selectedKeys.add(
            key
        );

        return true;
    }

    /*
     * 1. Scripts con coincidencia directa.
     */
    for (
        const candidate
        of rankedScripts
    ) {
        if (
            selected.length >=
            MAX_DIRECT_SCRIPTS
        ) {
            break;
        }

        if (
            candidate.score > 0
        ) {
            addCandidate(
                candidate
            );
        }
    }

    /*
     * 2. Relacionar scripts por referencias
     *    existentes dentro del código.
     *
     * No se necesita saber qué tipo de sistema
     * es ninguno de ellos.
     */
    let sourceOfSelected =
        selected
            .map(
                (item) =>
                    item.script.source
                        .toLowerCase()
            )
            .join("\n");

    let dependencyPassAdded =
        true;

    while (
        dependencyPassAdded &&
        selected.length <
            MAX_RELATED_SCRIPTS
    ) {
        dependencyPassAdded =
            false;

        for (
            const candidate
            of rankedScripts
        ) {
            if (
                selected.length >=
                MAX_RELATED_SCRIPTS
            ) {
                break;
            }

            const key =
                scriptKey(
                    candidate.script
                );

            if (
                selectedKeys.has(key)
            ) {
                continue;
            }

            const candidateName =
                candidate.script.name
                    .toLowerCase();

            if (
                candidateName.length < 3
            ) {
                continue;
            }

            if (
                sourceOfSelected.includes(
                    candidateName
                )
            ) {
                candidate.signals = [
                    ...candidate.signals,
                    `referenciado:${candidateName}`
                ];

                candidate.score += 20;

                addCandidate(
                    candidate
                );

                dependencyPassAdded =
                    true;

                sourceOfSelected =
                    selected
                        .map(
                            (item) =>
                                item.script
                                    .source
                                    .toLowerCase()
                        )
                        .join("\n");
            }
        }
    }

    /*
     * 3. Si el usuario menciona explícitamente
     *    el nombre de un script existente,
     *    garantizar su inclusión.
     */
    const queryString =
        String(query || "")
            .toLowerCase();

    for (
        const candidate
        of rankedScripts
    ) {
        if (
            selected.length >=
            MAX_RELATED_SCRIPTS
        ) {
            break;
        }

        const candidateName =
            candidate.script.name
                .toLowerCase();

        if (
            candidateName.length >= 3 &&
            queryString.includes(
                candidateName
            )
        ) {
            candidate.signals = [
                ...candidate.signals,
                "nombre-mencionado-directamente"
            ];

            candidate.score += 50;

            addCandidate(
                candidate
            );
        }
    }

    /*
     * Objetos.
     */
    const rankedObjects =
        Array.from(
            objects.values()
        )
            .map((object) => {
                const scored =
                    scoreObject(
                        object,
                        queryTerms
                    );

                return {
                    object,
                    score:
                        scored.score,
                    signals:
                        scored.signals
                };
            })
            .sort((a, b) =>
                b.score - a.score ||
                `${a.object.path}/${a.object.name}`.localeCompare(
                    `${b.object.path}/${b.object.name}`
                )
            );

    const hasObjectMatches =
        rankedObjects.some(
            (item) =>
                item.score > 0
        );

    const objectLimit =
        hasObjectMatches
            ? MAX_OBJECTS_WITH_MATCHES
            : MAX_OBJECTS_WITHOUT_MATCHES;

    const relevantObjects =
        rankedObjects
            .slice(
                0,
                objectLimit
            )
            .map(
                (item) => ({
                    className:
                        item.object
                            .className,

                    name:
                        item.object
                            .name,

                    path:
                        item.object
                            .path,

                    score:
                        item.score,

                    signals:
                        item.signals
                })
            );

    return {
        queryTerms,
        selected,
        relevantObjects
    };
}

app.post(
    "/project-scan",
    (req, res) => {
        try {
            const body = req.body;

            if (
                !body ||
                !Array.isArray(
                    body.scripts
                )
            ) {
                return res
                    .status(400)
                    .json({
                        ok: false,
                        error:
                            "Se esperaba scripts[]."
                    });
            }

            if (
                body.reset === true
            ) {
                scripts.clear();
                objects.clear();

                console.log(
                    "🧹 Contexto reiniciado."
                );
            }

            let accepted = 0;
            let rejected = 0;
            let objectAccepted = 0;
            let objectRejected = 0;

            for (
                const rawScript
                of body.scripts
            ) {
                const script =
                    normalizeScript(
                        rawScript
                    );

                if (!script) {
                    rejected++;
                    continue;
                }

                const key =
                    `${script.path}/${script.name}`;

                scripts.set(
                    key,
                    script
                );

                accepted++;
            }

            if (
                Array.isArray(
                    body.objects
                )
            ) {
                for (
                    const rawObject
                    of body.objects
                ) {
                    const object =
                        normalizeObject(
                            rawObject
                        );

                    if (!object) {
                        objectRejected++;
                        continue;
                    }

                    const key =
                        `${object.path}/${object.name}`;

                    objects.set(
                        key,
                        object
                    );

                    objectAccepted++;
                }
            }

            /*
             * Limitar scripts.
             */
            if (
                scripts.size >
                MAX_SCRIPTS
            ) {
                const entries =
                    Array.from(
                        scripts.entries()
                    ).sort((a, b) =>
                        a[0].localeCompare(
                            b[0]
                        )
                    );

                while (
                    entries.length >
                    MAX_SCRIPTS
                ) {
                    const [key] =
                        entries.pop();

                    scripts.delete(
                        key
                    );
                }
            }

            /*
             * Limitar objetos.
             */
            if (
                objects.size >
                MAX_OBJECTS
            ) {
                const entries =
                    Array.from(
                        objects.entries()
                    ).sort((a, b) =>
                        a[0].localeCompare(
                            b[0]
                        )
                    );

                while (
                    entries.length >
                    MAX_OBJECTS
                ) {
                    const [key] =
                        entries.pop();

                    objects.delete(
                        key
                    );
                }
            }

            lastScanAt =
                Date.now();

            console.log(
                `🔎 Escaneo: +${accepted} scripts | ${scripts.size} scripts | +${objectAccepted} objetos | ${objects.size} objetos.`
            );

            return res.json({
                ok: true,

                accepted,

                rejected,

                objectAccepted,

                objectRejected,

                totalScripts:
                    scripts.size,

                totalObjects:
                    objects.size
            });
        } catch (error) {
            console.error(
                "❌ Error procesando escaneo:",
                error
            );

            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        "Error procesando el escaneo."
                });
        }
    }
);

app.get(
    "/project-context",
    (req, res) => {
        try {
            const query =
                String(
                    req.query.query ||
                        ""
                ).trim();

            const result =
                selectRelevantScripts(
                    query
                );

            const selected =
                result.selected.map(
                    (item) => ({
                        className:
                            item.script
                                .className,

                        name:
                            item.script
                                .name,

                        path:
                            item.script
                                .path,

                        size:
                            item.script
                                .size,

                        score:
                            item.score,

                        signals:
                            item.signals,

                        hasSource:
                            item.script
                                .hasSource,

                        source:
                            item.script
                                .source
                    })
                );

            const missingSource =
                selected.filter(
                    (script) =>
                        !script.hasSource
                );

            console.log(
                `🧠 Contexto solicitado: "${query}"`
            );

            console.log(
                `   Términos utilizados: ${result.queryTerms.join(", ") || "(ninguno)"}`
            );

            console.log(
                `   Scripts totales: ${scripts.size}`
            );

            console.log(
                `   Scripts seleccionados: ${selected.length}`
            );

            console.log(
                `   Objetos incluidos: ${result.relevantObjects.length}`
            );

            console.log(
                `   SOURCE incluido: ${
                    selected.length -
                    missingSource.length
                }/${selected.length}`
            );

            for (
                const script
                of selected.slice(0, 12)
            ) {
                console.log(
                    `   - ${script.className}: ${script.path}/${script.name} | score=${script.score} | SOURCE=${script.hasSource ? "SI" : "NO"}`
                );
            }

            return res.json({
                ok: true,

                query,

                queryTerms:
                    result.queryTerms,

                totalScripts:
                    scripts.size,

                totalObjects:
                    objects.size,

                lastScanAt,

                manifest:
                    buildManifest(),

                objects:
                    result.relevantObjects,

                selected,

                diagnostics: {
                    selectedCount:
                        selected.length,

                    scriptsWithoutSource:
                        missingSource.length,

                    scriptsWithSource:
                        selected.length -
                        missingSource.length,

                    directMatches:
                        selected.filter(
                            (script) =>
                                script.score >
                                0
                        ).length
                }
            });
        } catch (error) {
            console.error(
                "❌ Error obteniendo contexto:",
                error
            );

            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        "Error obteniendo contexto."
                });
        }
    }
);

app.get(
    "/project-summary",
    (_req, res) => {
        return res.json({
            ok: true,

            totalScripts:
                scripts.size,

            totalObjects:
                objects.size,

            lastScanAt,

            manifest:
                buildManifest(),

            objects:
                buildObjects()
        });
    }
);

const server =
    app.listen(
        PORT,
        HOST,
        () => {
            console.log(
                "================================="
            );

            console.log(
                "🔎 ROBLOX PROJECT CONTEXT SERVER"
            );

            console.log(
                "================================="
            );

            console.log(
                `Contexto: http://${HOST}:${PORT}`
            );

            console.log(
                "Scripts + objetos del proyecto detectados."
            );

            console.log(
                "Sin categorías de sistemas predefinidas."
            );

            console.log(
                "Selección de contexto dinámica y general."
            );

            console.log(
                "=================================\n"
            );
        }
    );

server.on(
    "error",
    (error) => {
        console.error(
            "❌ Project Context no pudo abrir el servidor:",
            error
        );

        console.error(
            "   Puerto:",
            PORT
        );

        console.error(
            "   Host:",
            HOST
        );

        process.exitCode = 1;
    }
);

server.on(
    "close",
    () => {
        console.error(
            "⚠️ Project Context cerró el listener HTTP inesperadamente."
        );
    }
);

process.on(
    "uncaughtException",
    (error) => {
        console.error(
            "❌ uncaughtException en Project Context:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    (reason) => {
        console.error(
            "❌ unhandledRejection en Project Context:",
            reason
        );
    }
);

