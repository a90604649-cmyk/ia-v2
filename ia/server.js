
import "dotenv/config";
import express from "express";
import readline from "readline/promises";

import {
    OMNIROUTE_CONFIG,
    OMNIROUTE_MODEL_ID,
    preguntarOmniRoute,
    parsearRespuestaJson
} from "./omniRoute.js";

const app = express();

app.use(
    express.json({
        limit: "8mb"
    })
);

const PORT = Number(
    process.env.PORT || 3000
);

const PROJECT_CONTEXT_PORT = Number(
    process.env.PROJECT_CONTEXT_PORT || 3001
);

let pendingActions = [];
let lastExecutionReport = null;
let lastVisualCapture = null;
let visualReviewCycles = 0;
const MAX_VISUAL_REVIEW_CYCLES = 2;

let contextoScriptSeleccionado = null;
let contextoProyectoActual = null;

const historial = [];
const testResults = new Map();
const activeTestJobs = new Map();

const MAX_TEST_CYCLES = 3;
const MAX_VFX_ACTIONS = 120;

const SCRIPT_CLASSES = new Set([
    "Script",
    "LocalScript",
    "ModuleScript"
]);

const BASES = [
    "ServerScriptService",
    "ServerStorage",
    "ReplicatedStorage",
    "StarterGui",
    "StarterPlayer",
    "StarterPack",
    "Workspace",
    "SoundService",
    "Lighting",
    "ReplicatedFirst",
    "Teams",
    "TextChatService",
    "Chat"
];

const STANDARD_ACTIONS = new Set([
    "create_script",
    "create_local_script",
    "create_module_script",
    "update_script",
    "update_local_script",
    "update_module_script",
    "delete_script",
    "delete_local_script",
    "delete_module_script",
    "create_remote_event",
    "create_remote_function",
    "delete_remote_event",
    "delete_remote_function",
    "create_folder",
    "delete_folder"
]);

const EXTENDED_ACTIONS = new Set([
    "create_instance",
    "set_property",
    "set_properties",
    "run_studio_test",
    "rename_instance",
    "move_instance",
    "delete_instance"
]);

const EXTENDED_MARKER =
    "__ROBLOX_AI_EXTENDED_ACTION__";

/*
 * ============================================================
 * PROMPTS
 * ============================================================
 */

const VFX_SYSTEM = [
    "Eres un artista técnico senior especializado EXCLUSIVAMENTE en crear y refinar efectos visuales (VFX/PFX) dentro de Roblox Studio.",
    "Esta IA solo debe crear y refinar VFX directamente en Studio; no debe actuar como programador general.",
    "No generes scripts ni remotes como sustituto de los efectos. Usa acciones de instancias y propiedades para construir las capas visuales.",
    "No uses run_studio_test para juzgar calidad visual. No afirmes haber inspeccionado el viewport sin una captura real.",
    "Tu objetivo principal es construir el efecto directamente en el proyecto real mediante acciones de instancias y propiedades; no responder solo con un script para que el usuario lo ejecute.",
    "",
    "DISEÑO:",
    "Diseña efectos con intención visual: silueta, jerarquía, contraste, color, escala, profundidad, dirección, densidad y ritmo.",
    "No apiles capas al azar. Cada capa debe tener una función visual distinta y contribuir a una composición coherente.",
    "No confundas cantidad de objetos con calidad. Prefiere pocas capas bien configuradas antes que muchas capas redundantes.",
    "Cuando la petición incluya animación, especifica fases y movimiento de forma honesta. Crear instancias en modo edición no significa que una animación esté ejecutándose ni que se haya visto.",
    "",
    "FLUJO DE TRABAJO:",
    "1. Interpreta el efecto pedido y planifica sus capas.",
    "2. Revisa el contexto real del proyecto y reutiliza solo objetos relevantes que existan de verdad.",
    "3. Crea y configura las instancias directamente mediante actions.",
    "4. Mantén todo organizado bajo una carpeta o modelo con un nombre claro.",
    "5. Informa qué se creó, qué falló y qué no se pudo comprobar.",
    "No afirmes que el efecto se ve bien si no recibiste una captura visual verificable.",
    "",
    "INSTANCIAS:",
    "Usa create_instance con path (ruta del contenedor padre), name, className y properties.",
    "Puedes crear instancias Roblox válidas como Folder, Model, Part, Attachment, ParticleEmitter, Beam, Trail, PointLight y otras clases válidas.",
    "Crea las instancias padre antes que sus descendientes. Para rutas nuevas, el bridge puede crear carpetas contenedoras; no inventes que una acción se aplicó si el resultado del bridge no lo confirma.",
    "Usa set_property/set_properties para modificar objetos existentes. Usa move_instance para cambiar el padre; nunca simules Parent como una propiedad.",
    "No borres objetos existentes ajenos al efecto solicitado. No reemplaces sistemas de juego ni edites scripts de gameplay salvo que el usuario lo pida explícitamente.",
    "",
    "VALORES TIPADOS PARA PROPIEDADES:",
    "Vector2: {type:'Vector2',x:0,y:0}",
    "Vector3: {type:'Vector3',x:0,y:0,z:0}",
    "Color3: {type:'Color3',r:0.1,g:0.5,b:1} con canales de 0 a 1",
    "CFrame: {type:'CFrame',x:0,y:0,z:0,rx:0,ry:0,rz:0} con rotaciones en grados",
    "NumberRange: {type:'NumberRange',min:0,max:1}",
    "NumberSequence: {type:'NumberSequence',keypoints:[{time:0,value:0},{time:1,value:1}]}",
    "ColorSequence: {type:'ColorSequence',keypoints:[{time:0,color:{r:1,g:1,b:1}},{time:1,color:{r:0,g:0.5,b:1}}]}",
    "Para NumberSequence y ColorSequence usa al menos dos keypoints, tiempos entre 0 y 1 y ordenados de menor a mayor.",
    "Enum: {type:'Enum',enum:'Material',value:'Neon'}",
    "No envíes NumberSequence, ColorSequence o NumberRange como cadenas de texto; usa los objetos tipados descritos arriba.",
    "",
    "LÍMITES ACTUALES:",
    "El bridge puede aplicar acciones y comprobar estructura/propiedades, pero no dispone todavía de un bucle de captura visual implementado en esta rama.",
    "No digas que capturaste una imagen, inspeccionaste el viewport, ejecutaste una animación o validaste la calidad visual si no hay evidencia real de ello.",
    "Para una primera versión, prioriza efectos editables y visibles en el viewport de Studio sin pulsar Play. No uses run_studio_test como requisito para un efecto estático de edición.",
    "",
    "SALIDA:",
    "Devuelve UN SOLO objeto JSON válido con exactamente reply y actions.",
    "Sin markdown ni texto fuera del JSON.",
    "actions debe contener solamente acciones compatibles con el bridge.",
    "Si el usuario pidió solo analizar/revisar, devuelve actions: [].",
    "No afirmes que una acción se aplicó o probó si el bridge no lo confirmó."
].join("\n");

const CHAT_SYSTEM = [
    "Eres un asistente especializado en diseño de VFX/PFX para Roblox Studio.",
    "Ayuda con capas, silueta, color, escala, movimiento, densidad y materiales de efectos visuales.",
    "No conviertas las peticiones de VFX en programación general.",
    "Responde de forma clara y directa. No inventes resultados de ejecución."
].join("\n");

/*
 * ============================================================
 * HISTORIAL
 * ============================================================
 */

function agregarHistorial(role, text) {
    if (!text) {
        return;
    }

    historial.push({
        role,
        text: String(text)
    });

    if (historial.length > 24) {
        historial.splice(
            0,
            historial.length - 24
        );
    }
}

function crearContextoReciente(limite = 8) {
    return historial
        .slice(-limite)
        .map((m) =>
            `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.text}`
        )
        .join("\n");
}


/*
 * ============================================================
 * DETECCIÓN GENERAL DE TAREAS
 * ============================================================
 *
 * Este servidor está dedicado a Roblox Studio.
 *
 * Por eso NO es necesario comprobar que el usuario
 * diga "Roblox", "Studio", "script", "camera", etc.
 *
 * Cualquier petición que implique crear, modificar,
 * corregir, revisar, eliminar, analizar o cambiar
 * algo se considera una tarea del proyecto.
 *
 * No se utilizan categorías específicas de sistemas.
 */

function esTareaProyecto(texto) {
    const t =
        String(texto || "")
            .toLowerCase()
            .trim();

    if (!t) {
        return false;
    }

    const acciones = [
        "corrige",
        "corregir",
        "corrigelo",
        "corrígelo",
        "corrigele",
        "corrígele",

        "arregla",
        "arreglar",
        "arreglalo",
        "arréglalo",

        "soluciona",
        "solucionar",
        "solucionalo",
        "soluciónalo",

        "repara",
        "reparar",
        "reparalo",
        "repáralo",

        "modifica",
        "modificar",
        "modificalo",
        "modifícalo",

        "actualiza",
        "actualizar",
        "actualizalo",
        "actualízalo",

        "edita",
        "editar",
        "editalo",
        "edítalo",

        "ajusta",
        "ajustar",
        "ajustalo",
        "ajústalo",

        "configura",
        "configurar",

        "cambia",
        "cambiar",
        "cambialo",
        "cámbialo",

        "crea",
        "crear",
        "crealo",
        "créalo",
        "creame",
        "créame",

        "construye",
        "construir",

        "haz",
        "hacer",
        "hazme",
        "hazlo",

        "implementa",
        "implementar",

        "programa",
        "programar",

        "agrega",
        "agregar",
        "agregalo",
        "agrégalo",

        "añade",
        "añadir",
        "añadelo",
        "añádelo",

        "elimina",
        "eliminar",
        "eliminalo",
        "elimínalo",

        "borra",
        "borrar",
        "borrarlo",
        "bórralo",

        "quita",
        "quitar",
        "quitale",
        "quítale",

        "mueve",
        "mover",

        "renombra",
        "renombrar",

        "habilita",
        "habilitar",

        "deshabilita",
        "deshabilitar",

        "activa",
        "activar",

        "desactiva",
        "desactivar",

        "optimiza",
        "optimizar",

        "reemplaza",
        "reemplazar"
    ];

    const analisis = [
        "analiza",
        "analizar",
        "analizalo",
        "analízalo",

        "revisa",
        "revisar",
        "revisalo",
        "revísalo",

        "inspecciona",
        "inspeccionar",

        "estudia",
        "estudiar",

        "investiga",
        "investigar",

        "verifica",
        "verificar",

        "comprueba",
        "comprobar",

        "examina",
        "examinar",

        "diagnostica",
        "diagnosticar"
    ];

    const problemas = [
        "error",
        "errores",
        "bug",
        "bugs",
        "problema",
        "problemas",
        "falla",
        "fallo",
        "fallando",
        "falla",

        "no funciona",
        "no sirve",
        "no funciona bien",
        "dejo de funcionar",
        "dejó de funcionar",

        "esta roto",
        "está roto",
        "esta rota",
        "está rota",

        "se rompio",
        "se rompió"
    ];

    const tieneAccion =
        acciones.some(
            (x) =>
                t.includes(x)
        );

    const tieneAnalisis =
        analisis.some(
            (x) =>
                t.includes(x)
        );

    const tieneProblema =
        problemas.some(
            (x) =>
                t.includes(x)
        );

    return (
        tieneAccion ||
        tieneAnalisis ||
        tieneProblema
    );
}

function esSoloAnalisis(texto) {
    const t =
        String(texto || "")
            .toLowerCase()
            .trim();

    if (!t) {
        return false;
    }

    const analisis = [
        "analiza",
        "analizar",
        "analizalo",
        "analízalo",

        "revisa",
        "revisar",
        "revisalo",
        "revísalo",

        "inspecciona",
        "inspeccionar",

        "estudia",
        "estudiar",

        "investiga",
        "investigar",

        "verifica",
        "verificar",

        "comprueba",
        "comprobar",

        "examina",
        "examinar",

        "diagnostica",
        "diagnosticar",

        "solo analiza",
        "solo analizar",
        "solo revisa",
        "solo revisar",
        "solo verifica",
        "solo verificar",

        "sin modificar",
        "sin cambiar",
        "sin tocar",
        "no modifiques",
        "no modificar",
        "no cambies",
        "no cambiar",
        "no toques",
        "no tocar"
    ];

    const cambios = [
        "modifica",
        "modificar",
        "corrige",
        "corregir",
        "arregla",
        "arreglar",
        "soluciona",
        "solucionar",
        "repara",
        "reparar",

        "implementa",
        "implementar",

        "crea",
        "crear",

        "construye",
        "construir",

        "haz",
        "hacer",

        "elimina",
        "eliminar",

        "borra",
        "borrar",

        "quita",
        "quitar",

        "mueve",
        "mover",

        "cambia",
        "cambiar",

        "renombra",
        "renombrar",

        "habilita",
        "habilitar",

        "deshabilita",
        "deshabilitar",

        "activa",
        "activar",

        "desactiva",
        "desactivar",

        "agrega",
        "agregar",

        "añade",
        "añadir",

        "reemplaza",
        "reemplazar",

        "aplica",
        "aplicar",

        "actualiza",
        "actualizar",

        "edita",
        "editar",

        "ajusta",
        "ajustar",

        "optimiza",
        "optimizar"
    ];

    const tieneAnalisis =
        analisis.some(
            (x) =>
                t.includes(x)
        );

    const tieneCambio =
        cambios.some(
            (x) =>
                t.includes(x)
        );

    return (
        tieneAnalisis &&
        !tieneCambio
    );
}

function esReparacion(texto) {
    const t =
        String(texto || "")
            .toLowerCase()
            .trim();

    if (!t) {
        return false;
    }

    const reparacion = [
        "problema",
        "problemas",

        "error",
        "errores",

        "bug",
        "bugs",

        "falla",
        "fallo",
        "fallando",

        "no funciona",
        "no sirve",
        "no funciona bien",

        "dejo de funcionar",
        "dejó de funcionar",

        "esta roto",
        "está roto",
        "esta rota",
        "está rota",

        "se rompio",
        "se rompió",

        "corrige",
        "corregir",
        "corrigelo",
        "corrígelo",

        "arregla",
        "arreglar",
        "arreglalo",
        "arréglalo",

        "soluciona",
        "solucionar",
        "solucionalo",
        "soluciónalo",

        "repara",
        "reparar",
        "reparalo",
        "repáralo"
    ];

    return reparacion.some(
        (x) =>
            t.includes(x)
    );
}


/*
 * ============================================================
 * PROJECT CONTEXT
 * ============================================================
 */

async function solicitarContexto(query) {
    try {
        const response =
            await fetch(
                `http://127.0.0.1:${PROJECT_CONTEXT_PORT}/project-context?query=${encodeURIComponent(
                    String(query || "")
                )}`,
                {
                    headers: {
                        Accept:
                            "application/json"
                    },

                    signal:
                        AbortSignal.timeout(
                            20000
                        )
                }
            );

        if (!response.ok) {
            return null;
        }

        const data =
            await response.json();

        return data?.ok
            ? data
            : null;
    } catch (error) {
        console.warn(
            "⚠️ Project Context no disponible:",
            error instanceof Error
                ? error.message
                : String(error)
        );

        return null;
    }
}

async function obtenerContextoProyecto(
    mensaje
) {
    const query =
        String(mensaje || "")
            .trim();

    if (!query) {
        contextoProyectoActual =
            null;

        return null;
    }

    /*
     * IMPORTANTE:
     * Ya no agregamos conceptos artificiales.
     *
     * Se envía exactamente la petición
     * del usuario a Project Context.
     */
    const data =
        await solicitarContexto(
            query
        );

    contextoProyectoActual =
        data;

    return data;
}

/*
 * ============================================================
 * CONSTRUCCIÓN DEL CONTEXTO
 * ============================================================
 */

function construirContextoProyecto(
    proyecto
) {
    if (!proyecto) {
        return [
            "CONTEXTO REAL DE ROBLOX STUDIO:",
            "No se recibió contexto utilizable.",
            "NO inventes objetos ni scripts.",
            "NO inventes rutas.",
            "NO crees un sistema de reemplazo.",
            "Si no puedes identificar el objeto real, no generes una acción destructiva."
        ].join("\n");
    }

    const manifest =
        Array.isArray(
            proyecto.manifest
        )
            ? proyecto.manifest
            : [];

    const objects =
        Array.isArray(
            proyecto.objects
        )
            ? proyecto.objects
            : [];

    const selected =
        Array.isArray(
            proyecto.selected
        )
            ? proyecto.selected
            : [];

    const compactManifest =
        manifest
            .slice(0, 300)
            .map(
                (s) =>
                    `- ${s.className}: ${s.path}/${s.name}`
            )
            .join("\n");

    /*
     * Los objetos se muestran en el orden
     * recibido por Project Context.
     *
     * No se introducen prioridades artificiales.
     */
    const relevantObjects =
        objects
            .slice(0, 300)
            .map(
                (object) =>
                    `- ${object.className}: ${object.path}/${object.name}`
            )
            .join("\n");

    /*
     * Se respeta el ranking general de
     * Project Context.
     *
     * No se favorecen sistemas específicos.
     */
    const selectedOrdenado =
        [...selected];

    const sourceTexto =
        selectedOrdenado
            .slice(0, 24)
            .map(
                (s, i) =>
                    [
                        `### SOURCE RELEVANTE ${i + 1}`,
                        `TIPO: ${s.className}`,
                        `RUTA: ${s.path}`,
                        `NOMBRE: ${s.name}`,
                        `SCORE: ${s.score ?? 0}`,
                        `SEÑALES: ${
                            Array.isArray(
                                s.signals
                            )
                                ? s.signals.join(
                                      ", "
                                  )
                                : ""
                        }`,
                        "----- INICIO SOURCE REAL -----",
                        String(
                            s.source || ""
                        ).slice(
                            0,
                            14000
                        ),
                        "----- FIN SOURCE REAL -----"
                    ].join("\n")
            )
            .join("\n\n");

    return [
        "CONTEXTO REAL DE ROBLOX STUDIO:",
        `Consulta utilizada: ${
            proyecto.query || ""
        }`,
        `Scripts totales: ${
            proyecto.totalScripts ??
            manifest.length
        }`,
        `Objetos totales: ${
            proyecto.totalObjects ??
            objects.length
        }`,
        "",
        "MANIFEST REAL:",
        compactManifest ||
            "(ninguno)",
        "",
        "OBJETOS REALES:",
        relevantObjects ||
            "(ninguno)",
        "",
        "SOURCE RELEVANTE REAL:",
        sourceTexto ||
            "(ninguno)",
        "",
        "IMPORTANTE:",
        "- Los objetos del contexto son reales.",
        "- Las rutas del contexto son reales.",
        "- El SOURCE del contexto es real.",
        "- No inventes nombres.",
        "- No inventes rutas.",
        "- No inventes SOURCE.",
        "- Si existe un sistema relacionado, trabaja sobre ese sistema.",
        "- Si no existe nada relacionado y el usuario pidió crear algo nuevo, puedes crear lo necesario."
    ]
        .join("\n")
        .slice(0, 70000);
}

function construirContextoSeleccionado() {
    if (
        !contextoScriptSeleccionado
    ) {
        return "";
    }

    return [
        "SCRIPT SELECCIONADO POR EL USUARIO:",
        `TIPO: ${
            contextoScriptSeleccionado
                .className
        }`,
        `RUTA: ${
            contextoScriptSeleccionado
                .path
        }`,
        `NOMBRE: ${
            contextoScriptSeleccionado
                .name
        }`,
        "----- SOURCE -----",
        contextoScriptSeleccionado
            .source,
        "----- FIN SOURCE -----"
    ].join("\n");
}

/*
 * ============================================================
 * VALIDACIONES GENERALES
 * ============================================================
 */

function rutaValida(path) {
    return BASES.some(
        (base) =>
            path === base ||
            path.startsWith(
                `${base}/`
            )
    );
}

function nombreValido(name) {
    return (
        Boolean(name) &&
        !name.includes("/") &&
        !name.includes("\\") &&
        name !== "." &&
        name !== ".."
    );
}

function separarTarget(target) {
    const limpio =
        String(target || "")
            .trim()
            .replaceAll("\\", "/")
            .replace(/\/+/g, "/")
            .replace(/^\/+/, "")
            .replace(/\/+$/, "");

    if (!limpio) {
        return {
            path: "",
            name: ""
        };
    }

    const partes =
        limpio
            .split("/")
            .map(
                (x) => x.trim()
            )
            .filter(Boolean);

    if (
        partes.length >= 2
    ) {
        const name =
            partes.pop();

        return {
            path:
                partes.join(
                    "/"
                ),
            name
        };
    }

    return {
        path: limpio,
        name: ""
    };
}

function existeEnLista(
    lista,
    path,
    name,
    className = ""
) {
    if (
        !Array.isArray(lista)
    ) {
        return false;
    }

    const esperadoPath =
        String(path || "")
            .replaceAll(
                ".",
                "/"
            );

    const esperadoName =
        String(name || "");

    return lista.some(
        (item) => {
            if (
                !item ||
                typeof item !==
                    "object"
            ) {
                return false;
            }

            const itemPath =
                String(
                    item.path || ""
                )
                    .replaceAll(
                        ".",
                        "/"
                    );

            const itemName =
                String(
                    item.name || ""
                );

            const itemClass =
                String(
                    item.className ||
                    item.ClassName ||
                    ""
                );

            if (
                itemPath !==
                    esperadoPath ||
                itemName !==
                    esperadoName
            ) {
                return false;
            }

            return (
                !className ||
                !itemClass ||
                itemClass ===
                    className
            );
        }
    );
}

function existeObjetoReal(
    path,
    name,
    className = ""
) {
    const proyecto =
        contextoProyectoActual;

    if (!proyecto) {
        return false;
    }

    if (
        existeEnLista(
            proyecto.manifest,
            path,
            name,
            className
        )
    ) {
        return true;
    }

    if (
        existeEnLista(
            proyecto.objects,
            path,
            name,
            className
        )
    ) {
        return true;
    }

    if (
        existeEnLista(
            proyecto.selected,
            path,
            name,
            className
        )
    ) {
        return true;
    }

    return false;
}

/*
 * ============================================================
 * ACCIONES EXTENDIDAS
 * ============================================================
 */

function parsearAccionExtendidaEmpaquetada(
    raw
) {
    if (
        !raw ||
        typeof raw !==
            "object" ||
        typeof raw.code !==
            "string"
    ) {
        return null;
    }

    const code =
        raw.code.trim();

    if (
        !code.startsWith(
            EXTENDED_MARKER
        )
    ) {
        return null;
    }

    const json =
        code
            .slice(
                EXTENDED_MARKER.length
            )
            .trim();

    try {
        const parsed =
            JSON.parse(json);

        return parsed &&
            typeof parsed ===
                "object"
            ? parsed
            : null;
    } catch {
        return null;
    }
}

/*
 * ============================================================
 * NORMALIZACIÓN DE ACCIONES
 * ============================================================
 */

function normalizarAccion(
    rawAction,
    options = {}
) {
    if (
        !rawAction ||
        typeof rawAction !==
            "object"
    ) {
        return null;
    }

    const repairMode =
        options.repairMode === true;

    const soloAnalisis =
        options.soloAnalisis === true;

    /*
     * Detectar acciones extendidas empaquetadas.
     */
    const packed =
        parsearAccionExtendidaEmpaquetada(
            rawAction
        );

    if (packed) {
        if (
            repairMode &&
            (
                packed.type ===
                    "create_instance" ||
                packed.type ===
                    "create_script" ||
                packed.type ===
                    "create_local_script" ||
                packed.type ===
                    "create_module_script"
            )
        ) {
            console.warn(
                "🛑 Creación nueva bloqueada durante reparación:",
                JSON.stringify(
                    packed,
                    null,
                    2
                )
            );

            return null;
        }
    }

    let type =
        String(
            rawAction.type ||
            rawAction.operation ||
            rawAction.action ||
            rawAction.actionType ||
            rawAction.action_type ||
            rawAction.command ||
            ""
        )
            .trim()
            .toLowerCase();

    let className =
        String(
            rawAction.className ||
            rawAction.class ||
            rawAction.scriptType ||
            rawAction.script_class ||
            ""
        ).trim();

    let path =
        String(
            rawAction.path ||
            rawAction.parentPath ||
            rawAction.folder ||
            rawAction.container ||
            rawAction.scriptPath ||
            rawAction.target ||
            ""
        ).trim();

    let name =
        String(
            rawAction.name ||
            rawAction.scriptName ||
            rawAction.targetName ||
            rawAction.objectName ||
            ""
        ).trim();

    const code =
        String(
            rawAction.code ||
            rawAction.source ||
            rawAction.script ||
            rawAction.content ||
            rawAction.sourceCode ||
            ""
        );

    const typeAliases = {
        update:
            className ===
            "LocalScript"
                ? "update_local_script"
                : className ===
                      "ModuleScript"
                    ? "update_module_script"
                    : "update_script",

        edit:
            className ===
            "LocalScript"
                ? "update_local_script"
                : className ===
                      "ModuleScript"
                    ? "update_module_script"
                    : "update_script",

        modify:
            className ===
            "LocalScript"
                ? "update_local_script"
                : className ===
                      "ModuleScript"
                    ? "update_module_script"
                    : "update_script",

        create:
            className ===
            "LocalScript"
                ? "create_local_script"
                : className ===
                      "ModuleScript"
                    ? "create_module_script"
                    : "create_script"
    };

    if (typeAliases[type]) {
        type =
            typeAliases[type];
    }

    const classByType = {
        create_script:
            "Script",

        create_local_script:
            "LocalScript",

        create_module_script:
            "ModuleScript",

        update_script:
            "Script",

        update_local_script:
            "LocalScript",

        update_module_script:
            "ModuleScript",

        delete_script:
            "Script",

        delete_local_script:
            "LocalScript",

        delete_module_script:
            "ModuleScript"
    };

    if (
        !className &&
        classByType[type]
    ) {
        className =
            classByType[type];
    }

    /*
     * REPARACIÓN:
     * no crear reemplazos.
     */
    if (
        repairMode &&
        (
            type ===
                "create_script" ||
            type ===
                "create_local_script" ||
            type ===
                "create_module_script" ||
            type ===
                "create_instance"
        )
    ) {
        console.warn(
            "🛑 Acción de creación rechazada durante reparación:",
            JSON.stringify(
                rawAction,
                null,
                2
            )
        );

        return null;
    }

    /*
     * SOLO ANÁLISIS.
     */
    if (soloAnalisis) {
        return null;
    }

    /*
     * PRUEBA.
     */
    if (
        type ===
        "run_studio_test"
    ) {
        const numPlayers =
            Math.max(
                1,
                Math.min(
                    8,
                    Number(
                        rawAction.numPlayers ||
                        rawAction.players ||
                        2
                    )
                )
            );

        const duration =
            Math.max(
                3,
                Math.min(
                    60,
                    Number(
                        rawAction.duration ||
                        10
                    )
                )
            );

        const serverCode =
            String(
                rawAction.serverCode ||
                ""
            ).trim();

        const clientCode =
            String(
                rawAction.clientCode ||
                ""
            ).trim();

        if (
            !serverCode &&
            !clientCode
        ) {
            return null;
        }

        return {
            type,

            testId:
                String(
                    rawAction.testId ||
                    `test_${Date.now()}_${Math.random()
                        .toString(
                            36
                        )
                        .slice(
                            2,
                            8
                        )}`
                ),

            numPlayers,

            duration,

            serverCode,

            clientCode
        };
    }

    if (
        !STANDARD_ACTIONS.has(
            type
        ) &&
        !EXTENDED_ACTIONS.has(
            type
        )
    ) {
        return null;
    }

    /*
     * Separar target completo.
     */
    if (
        path &&
        !rutaValida(path)
    ) {
        const separado =
            separarTarget(path);

        if (
            separado.path &&
            separado.name
        ) {
            path =
                separado.path;

            name =
                name ||
                separado.name;
        }
    }

    if (
        path &&
        !name
    ) {
        const partes =
            path
                .replaceAll(
                    "\\",
                    "/"
                )
                .split("/")
                .filter(Boolean);

        if (
            partes.length >= 2
        ) {
            name =
                partes.pop();

            path =
                partes.join("/");
        }
    }

    path =
        path
            .replaceAll(
                "\\",
                "/"
            )
            .replace(
                /^\/+/,
                ""
            )
            .replace(
                /\/+$/,
                ""
            );

    if (
        !path ||
        !rutaValida(path) ||
        !nombreValido(name)
    ) {
        return null;
    }

    /*
     * ========================================================
     * ACCIONES EXTENDIDAS
     * ========================================================
     */

    if (
        EXTENDED_ACTIONS.has(
            type
        )
    ) {
        if (
            type ===
            "create_instance"
        ) {
            if (!className) {
                return null;
            }

            if (repairMode) {
                return null;
            }

            return {
                type,
                className,
                path,
                name,

                properties:
                    rawAction.properties &&
                    typeof rawAction.properties ===
                        "object"
                        ? rawAction.properties
                        : {}
            };
        }

        if (
            type ===
            "set_property"
        ) {
            const property =
                String(
                    rawAction.property ||
                    ""
                ).trim();

            if (
                !property ||
                [
                    "Parent",
                    "ClassName",
                    "Source",
                    "Archivable"
                ].includes(
                    property
                )
            ) {
                return null;
            }

            if (
                repairMode &&
                !existeObjetoReal(
                    path,
                    name,
                    className
                )
            ) {
                console.warn(
                    "🛑 set_property rechazado: objeto no encontrado en contexto:",
                    `${path}/${name}`
                );

                return null;
            }

            return {
                type,
                className,
                path,
                name,
                property,
                value:
                    rawAction.value
            };
        }

        if (
            type ===
            "set_properties"
        ) {
            if (
                !rawAction.properties ||
                typeof rawAction.properties !==
                    "object"
            ) {
                return null;
            }

            if (
                repairMode &&
                !existeObjetoReal(
                    path,
                    name,
                    className
                )
            ) {
                console.warn(
                    "🛑 set_properties rechazado: objeto no encontrado en contexto:",
                    `${path}/${name}`
                );

                return null;
            }

            return {
                type,
                className,
                path,
                name,
                properties:
                    rawAction.properties
            };
        }

        if (
            type ===
            "rename_instance"
        ) {
            const newName =
                String(
                    rawAction.newName ||
                    ""
                ).trim();

            if (
                !nombreValido(
                    newName
                )
            ) {
                return null;
            }

            if (
                repairMode &&
                !existeObjetoReal(
                    path,
                    name,
                    className
                )
            ) {
                return null;
            }

            return {
                type,
                className,
                path,
                name,
                newName
            };
        }

        if (
            type ===
            "move_instance"
        ) {
            const targetPath =
                String(
                    rawAction.targetPath ||
                    rawAction.destination ||
                    rawAction.destinationPath ||
                    ""
                )
                    .trim()
                    .replaceAll(
                        "\\",
                        "/"
                    );

            if (
                !rutaValida(
                    targetPath
                )
            ) {
                return null;
            }

            if (
                repairMode &&
                !existeObjetoReal(
                    path,
                    name,
                    className
                )
            ) {
                return null;
            }

            return {
                type,
                className,
                path,
                name,
                targetPath
            };
        }

        if (
            type ===
            "delete_instance"
        ) {
            if (
                repairMode &&
                !existeObjetoReal(
                    path,
                    name,
                    className
                )
            ) {
                return null;
            }

            return {
                type,
                className,
                path,
                name
            };
        }
    }

    /*
     * ========================================================
     * SCRIPTS
     * ========================================================
     */

    const requiredClass =
        classByType[type];

    if (!requiredClass) {
        return null;
    }

    if (
        className !==
        requiredClass
    ) {
        return null;
    }

    /*
     * UPDATE:
     * el script debe existir.
     */
    if (
        repairMode &&
        type.startsWith(
            "update_"
        ) &&
        !existeObjetoReal(
            path,
            name,
            requiredClass
        )
    ) {
        console.warn(
            "🛑 UPDATE rechazado: el script no existe en el contexto real:",
            `${path}/${name}`
        );

        return null;
    }

    /*
     * DELETE:
     * el script debe existir.
     */
    if (
        repairMode &&
        type.startsWith(
            "delete_"
        ) &&
        !existeObjetoReal(
            path,
            name,
            requiredClass
        )
    ) {
        console.warn(
            "🛑 DELETE rechazado: el script no existe en el contexto real:",
            `${path}/${name}`
        );

        return null;
    }

    /*
     * SOURCE OBLIGATORIO.
     */
    if (
        !type.startsWith(
            "delete_"
        ) &&
        !code.trim()
    ) {
        return null;
    }

    /*
     * Evitar respuestas claramente
     * truncadas o inválidas.
     */
    if (
        !type.startsWith(
            "delete_"
        ) &&
        code.length < 20
    ) {
        return null;
    }

    const result = {
        type,
        className:
            requiredClass,
        path,
        name
    };

    if (
        !type.startsWith(
            "delete_"
        )
    ) {
        result.code =
            code;
    }

    return result;
}

/*
 * ============================================================
 * RESPUESTAS JSON
 * ============================================================
 */

function contieneToolCalls(
    texto
) {
    const raw =
        String(texto || "")
            .toLowerCase();

    return (
        raw.includes(
            '"tool_name"'
        ) ||
        raw.includes(
            '"tool_call_id"'
        ) ||
        raw.includes(
            '"get_source"'
        ) ||
        raw.includes(
            '"read_source"'
        ) ||
        raw.includes(
            '"inspect_source"'
        ) ||
        raw.includes(
            '"get_script"'
        ) ||
        raw.includes(
            '"read_script"'
        )
    );
}

function esAccionPermitidaVFX(action, mensajeUsuario = "") {
    if (!action || typeof action !== "object" || action.type !== "update_script" || typeof action.code !== "string") {
        return false;
    }

    const marker = "__ROBLOX_AI_EXTENDED_ACTION__";
    if (!action.code.startsWith(marker)) return false;

    let payload;
    try {
        payload = JSON.parse(action.code.slice(marker.length).trim());
    } catch {
        return false;
    }

    const actionType = String(payload.type || "");
    const className = String(payload.className || "");
    const forbiddenClasses = new Set(["Script", "LocalScript", "ModuleScript", "RemoteEvent", "RemoteFunction"]);
    if (forbiddenClasses.has(className)) return false;

    const visualClasses = new Set(["Folder", "Model", "Part", "MeshPart", "WedgePart", "CornerWedgePart", "Attachment", "ParticleEmitter", "Beam", "Trail", "PointLight", "SpotLight", "SurfaceLight", "Highlight", "Texture", "Decal", "SpecialMesh", "BlockMesh", "CylinderMesh", "Fire", "Smoke", "Sparkles", "BillboardGui", "SurfaceGui", "Frame", "ImageLabel", "ImageButton", "UIGradient", "UICorner"]);
    if (!visualClasses.has(className)) return false;

    const allowed = new Set(["create_instance", "set_property", "set_properties", "rename_instance", "move_instance"]);
    if (allowed.has(actionType)) return true;

    const explicitlyRequestsDeletion = /elimina|eliminar|borra|borrar|quita|quitar|remove|delete/i.test(String(mensajeUsuario));
    return actionType === "delete_instance" && explicitlyRequestsDeletion;
}
function extraerResultado(
    texto,
    options = {}
) {
    if (
        contieneToolCalls(
            texto
        )
    ) {
        console.warn(
            "⚠️ OmniRoute intentó usar una herramienta inexistente."
        );

        return null;
    }

    const parsed =
        parsearRespuestaJson(
            texto
        );

    if (
        !parsed ||
        typeof parsed !==
            "object"
    ) {
        return null;
    }

    const actions = [];
    const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
    if (rawActions.length > MAX_VFX_ACTIONS) {
        console.warn(`[RobloxAI] Se limitaron las acciones VFX a ${MAX_VFX_ACTIONS} para evitar cambios excesivos en Studio.`);
    }

    for (
        const raw of rawActions.slice(0, MAX_VFX_ACTIONS)
    ) {
        const action =
            normalizarAccion(
                raw,
                options
            );

        if (action && !esAccionPermitidaVFX(action, options.mensajeUsuario)) {
            console.warn("⚠️ Acción rechazada: esta rama solo permite acciones visuales de VFX.");
            continue;
        }

        if (action) {
            actions.push(
                action
            );
        } else {
            console.warn(
                "⚠️ Acción OmniRoute rechazada:",
                JSON.stringify(
                    raw,
                    null,
                    2
                )
            );
        }
    }

    const unique =
        new Map();

    for (
        const action of actions
    ) {
        const key =
            action.type ===
            "run_studio_test"
                ? `${action.type}|${action.testId}`
                : `${action.type}|${action.path}/${action.name}|${action.property || ""}`;

        unique.set(
            key,
            action
        );
    }

    return {
        reply:
            String(
                parsed.reply ||
                    ""
            ).trim(),

        actions: [
            ...unique.values()
        ]
    };
}

/*
 * ============================================================
 * TESTS
 * ============================================================
 */

function extraerTestEmpaquetado(
    action
) {
    const packed =
        parsearAccionExtendidaEmpaquetada(
            action
        );

    if (
        packed?.type ===
        "run_studio_test"
    ) {
        return {
            ...packed,

            testId:
                String(
                    packed.testId ||
                    `test_${Date.now()}_${Math.random()
                        .toString(
                            36
                        )
                        .slice(
                            2,
                            8
                        )}`
                )
        };
    }

    return null;
}

function obtenerTestsDeAcciones(
    actions
) {
    if (!Array.isArray(actions)) {
        return [];
    }

    const tests = [];

    for (
        const action of actions
    ) {
        if (
            action?.type ===
                "run_studio_test" &&
            action.testId
        ) {
            tests.push(
                action
            );

            continue;
        }

        const packed =
            extraerTestEmpaquetado(
                action
            );

        if (packed) {
            tests.push(
                packed
            );
        }
    }

    return tests;
}

function registrarTests(
    mensajeOriginal,
    actions,
    ciclo = 1
) {
    const tests =
        obtenerTestsDeAcciones(
            actions
        );

    for (
        const test of tests
    ) {
        activeTestJobs.set(
            test.testId,
            {
                testId:
                    test.testId,
                mensajeOriginal,
                ciclo,
                maxCycles:
                    MAX_TEST_CYCLES
            }
        );

        console.log(
            `[RobloxAI] 🧪 Test registrado ${test.testId} | ciclo ${ciclo}/${MAX_TEST_CYCLES}`
        );
    }
}

/*
 * ============================================================
 * OMNIROUTE
 * ============================================================
 */

async function pedirRespuestaEjecutable(
    messages,
    extra = ""
) {
    const finalMessages =
        extra
            ? [
                ...messages,
                {
                    role:
                        "user",
                    content:
                        extra
                }
            ]
            : messages;

    return preguntarOmniRoute(
        finalMessages,
        {
            json: true,
            reasoningEffort:
                "none",
            reasoningFormat:
                "hidden",
            temperature:
                0.1,
            maxCompletionTokens:
                Math.min(
                    12000,
                    Number(
                        process.env
                            .OMNIROUTE_MAX_OUTPUT_TOKENS ||
                        12000
                    )
                ),
            timeoutMs:
                Number(
                    process.env
                        .OMNIROUTE_TIMEOUT_MS ||
                    300000
                ),
            attemptsPerKey:
                2
        }
    );
}

/*
 * ============================================================
 * CORRECCIÓN AUTOMÁTICA
 * ============================================================
 */

async function pedirCorreccion(
    mensajeOriginal,
    resultadoPrueba
) {
    const proyecto =
        await obtenerContextoProyecto(
            mensajeOriginal
        );

    const contexto =
        construirContextoProyecto(
            proyecto
        );

    const errors =
        Array.isArray(
            resultadoPrueba?.errors
        )
            ? resultadoPrueba.errors
            : [];

    const warnings =
        Array.isArray(
            resultadoPrueba?.warnings
        )
            ? resultadoPrueba.warnings
            : [];

    const prompt = [
        "CORRECCIÓN AUTOMÁTICA DESPUÉS DE UNA PRUEBA REAL.",
        "",
        "PETICIÓN ORIGINAL:",
        mensajeOriginal,
        "",
        "RESULTADO REAL:",
        JSON.stringify(
            {
                ok:
                    resultadoPrueba?.ok,

                executionOk:
                    resultadoPrueba
                        ?.executionOk,

                testId:
                    resultadoPrueba
                        ?.testId,

                errorCount:
                    resultadoPrueba
                        ?.errorCount,

                warningCount:
                    resultadoPrueba
                        ?.warningCount,

                errors:
                    errors.slice(
                        0,
                        40
                    ),

                warnings:
                    warnings.slice(
                        0,
                        40
                    )
            },
            null,
            2
        ),
        "",
        contexto,
        "",
        "INSTRUCCIONES:",
        "Analiza primero el SOURCE REAL.",
        "Identifica el objeto real responsable.",
        "Corrige el sistema existente.",
        "NO crees un sistema nuevo.",
        "Para update_* debes devolver SOURCE COMPLETO.",
        "No uses get_source ni read_source.",
        "Incluye una nueva run_studio_test.",
        "Devuelve solamente JSON."
    ].join("\n");

    const texto =
        await preguntarOmniRoute(
            [
                {
                    role:
                        "system",
                    content:
                        VFX_SYSTEM
                },
                {
                    role:
                        "user",
                    content:
                        prompt
                }
            ],
            {
                json: true,
                reasoningEffort:
                    "none",
                reasoningFormat:
                    "hidden",
                temperature:
                    0.05,
                maxCompletionTokens:
                    Math.min(
                        12000,
                        Number(
                            process.env
                                .OMNIROUTE_MAX_OUTPUT_TOKENS ||
                            12000
                        )
                    ),
                timeoutMs:
                    Number(
                        process.env
                            .OMNIROUTE_TIMEOUT_MS ||
                        300000
                    ),
                attemptsPerKey:
                    2
            }
        );

    return extraerResultado(
        texto,
        {
            repairMode:
                true,
            mensajeUsuario:
                mensajeOriginal
        }
    );
}

/*
 * ============================================================
 * CREACIÓN Y REFINAMIENTO DE VFX
 * ============================================================
 */

async function procesarVFX(
    mensajeUsuario,
    soloAnalisis = false
) {
    visualReviewCycles = 0;
    lastVisualCapture = null;
    // El refinamiento de VFX puede requerir añadir capas; no aplicar restricciones de reparación de sistemas de código.
    const reparacion = false;

    const proyecto =
        await obtenerContextoProyecto(
            mensajeUsuario
        );

    const contexto =
        construirContextoProyecto(
            proyecto
        );

    const seleccionado =
        construirContextoSeleccionado();

    const reciente =
        crearContextoReciente(
            6
        );

    // Las pruebas de juego no validan la apariencia de un VFX.
    const debeProbar = false;

    const modo =
        soloAnalisis
            ? [
                "MODO: SOLO ANÁLISIS VISUAL.",
                "No implementes cambios.",
                "actions debe ser []."
            ].join("\n")
            : [
                "MODO: CREACIÓN O REFINAMIENTO DIRECTO DE VFX.",
                "No estás programando un sistema de juego.",
                "Crea o modifica instancias visuales en el proyecto real de Studio.",
                "Puedes añadir nuevas capas, piezas y Attachments si mejoran el efecto.",
                "No crees scripts, remotes ni pruebas de juego.",
                "Organiza el efecto bajo un Model o Folder dedicado.",
                "No borres objetos ajenos a la petición."
            ].join("\n");

    const contenido = [
        modo,
        "",
        "PETICIÓN DEL USUARIO:",
        mensajeUsuario,
        "",
        "HISTORIAL:",
        reciente ||
            "(sin historial)",
        "",
        contexto,
        "",
        seleccionado,
        "",
        "VERIFICACIÓN OBLIGATORIA:",
        "Usa el MANIFEST y el catálogo de objetos para identificar contenedores y anclajes reales.",
        "No inspecciones ni modifiques SOURCE de scripts como sustituto del trabajo visual.",
        "Si el usuario indica un objeto de destino, verifica que exista en el contexto antes de referenciarlo.",
        "Si no se especifica un anclaje, crea el efecto bajo un Model dedicado en Workspace sin modificar objetos ajenos.",
        "La respuesta será ejecutada por Roblox Studio en modo edición."
    ].join("\n");

    const messages = [
        {
            role:
                "system",
            content:
                VFX_SYSTEM
        },
        {
            role:
                "system",
            content:
                "MODO EJECUTOR ROBLOX."
        },
        {
            role:
                "user",
            content:
                contenido
        }
    ];

    try {
        console.log(
            `🤖 OmniRoute diseñando VFX con ${OMNIROUTE_MODEL_ID}...`
        );

        if (
            reparacion &&
            proyecto
        ) {
            console.log(
                `[RobloxAI] 🔎 Contexto para reparación: ${
                    proyecto.totalScripts ??
                    (
                        Array.isArray(
                            proyecto.manifest
                        )
                            ? proyecto
                                  .manifest
                                  .length
                            : 0
                    )
                } scripts | ${
                    proyecto.totalObjects ??
                    (
                        Array.isArray(
                            proyecto.objects
                        )
                            ? proyecto
                                  .objects
                                  .length
                            : 0
                    )
                } objetos | ${
                    Array.isArray(
                        proyecto.selected
                    )
                        ? proyecto
                              .selected
                              .length
                        : 0
                } seleccionados`
            );
        }

        let texto =
            await pedirRespuestaEjecutable(
                messages
            );

        let resultado =
            extraerResultado(
                texto,
                {
                    repairMode:
                        reparacion,
                    soloAnalisis,
                    mensajeUsuario
                }
            );

        if (
            (!resultado ||
                resultado.actions
                    .length === 0) &&
            !soloAnalisis
        ) {
            console.warn(
                reparacion
                    ? "⚠️ La respuesta de reparación no fue ejecutable. Exigiendo modificación de un objeto REAL."
                    : "⚠️ La primera respuesta no fue ejecutable. Pidiendo SOURCE completo y acciones válidas..."
            );

            const retry = [
                "RESPUESTA INVÁLIDA.",
                "No devuelvas solamente action, target o description: devuelve acciones ejecutables.",
                "Para crear un VFX nuevo puedes crear instancias visuales nuevas; crea primero los padres y después sus hijos.",
                "No crees scripts, remotes ni pruebas de juego.",
                "Usa únicamente acciones de instancias y propiedades compatibles con el bridge.",
                "No modifiques ni borres instancias existentes si no puedes identificarlas con seguridad.",
                debeProbar
                    ? "También debes incluir run_studio_test."
                    : "",
                "Devuelve solamente JSON."
            ].join("\n");

            texto =
                await pedirRespuestaEjecutable(
                    messages,
                    retry
                );

            resultado =
                extraerResultado(
                    texto,
                    {
                        repairMode:
                            reparacion,
                        soloAnalisis,
                        mensajeUsuario
                    }
                );
        }

        if (!resultado) {
            console.error(
                "❌ OmniRoute no produjo una respuesta ejecutable válida."
            );

            return null;
        }

        if (
            !soloAnalisis &&
            resultado.actions.length ===
                0
        ) {
            console.error(
                "❌ OmniRoute respondió sin acciones ejecutables."
            );

            console.log(
                resultado.reply ||
                    "Sin explicación."
            );

            return null;
        }

        if (
            !soloAnalisis &&
            debeProbar &&
            obtenerTestsDeAcciones(
                resultado.actions
            ).length === 0
        ) {
            console.warn(
                "⚠️ La modificación no incluyó run_studio_test. Solicitando una versión comprobable..."
            );

            texto =
                await pedirRespuestaEjecutable(
                    messages,
                    [
                        reparacion
                            ? "Estás reparando un sistema existente."
                            : "Estás implementando un cambio.",
                        "Usa solamente objetos reales del contexto.",
                        "No crees scripts nuevos durante una reparación.",
                        "No inventes nombres.",
                        "Si actualizas un script devuelve SOURCE COMPLETO.",
                        "Después incluye run_studio_test.",
                        "Devuelve solamente JSON."
                    ].join("\n")
                );

            resultado =
                extraerResultado(
                    texto,
                    {
                        repairMode:
                            reparacion,
                        mensajeUsuario
                    }
                );
        }

        if (!resultado) {
            return null;
        }

        pendingActions =
            resultado.actions;

        registrarTests(
            mensajeUsuario,
            pendingActions,
            1
        );

        agregarHistorial(
            "user",
            mensajeUsuario
        );

        agregarHistorial(
            "assistant",
            resultado.reply ||
                `Se prepararon ${resultado.actions.length} acciones.`
        );

        console.log(
            `✅ OmniRoute terminó: ${pendingActions.length} acción(es) listas para Roblox Studio.`
        );

        console.log(
            resultado.reply ||
                "Cambios preparados."
        );

        return resultado;
    } catch (error) {
        console.error(
            "❌ Error de OmniRoute:",
            error instanceof Error
                ? error.message
                : String(error)
        );

        return null;
    }
}

/*
 * ============================================================
 * CHAT
 * ============================================================
 */

async function responderChat(
    mensajeUsuario
) {
    try {
        const texto =
            await preguntarOmniRoute(
                [
                    {
                        role:
                            "system",
                        content:
                            CHAT_SYSTEM
                    },

                    ...historial
                        .slice(-8)
                        .map(
                            (m) => ({
                                role:
                                    m.role,
                                content:
                                    m.text
                            })
                        ),

                    {
                        role:
                            "user",
                        content:
                            mensajeUsuario
                    }
                ],
                {
                    reasoningEffort:
                        process.env
                            .OMNIROUTE_REASONING_EFFORT ||
                        "default",

                    reasoningFormat:
                        "hidden",

                    temperature:
                        0.5,

                    maxCompletionTokens:
                        Math.min(
                            700,
                            Number(
                                process.env
                                    .OMNIROUTE_MAX_OUTPUT_TOKENS ||
                                700
                            )
                        ),

                    attemptsPerKey:
                        1
                }
            );

        agregarHistorial(
            "user",
            mensajeUsuario
        );

        agregarHistorial(
            "assistant",
            texto
        );

        console.log(
            `\n${texto}`
        );

        return texto;
    } catch (error) {
        console.error(
            "❌ Error de OmniRoute:",
            error instanceof Error
                ? error.message
                : String(error)
        );

        return null;
    }
}

/*
 * ============================================================
 * API
 * ============================================================
 */

app.get(
    "/",
    (_req, res) => {
        res.json({
            ok: true,

            service:
                "Roblox AI Bridge",

            provider:
                "OmniRoute",

            model:
                OMNIROUTE_MODEL_ID,

            capabilities: [
                "vfx-authoring",
                "particle-emitters",
                "beams-trails-attachments",
                "typed-visual-properties",
                "number-color-sequences",
                "direct-studio-instance-editing",
                "organized-vfx-hierarchy",
                "project-context"
            ],

            pendingActions:
                pendingActions.length,

            lastExecutionReport,

            activeTests:
                activeTestJobs.size
        });
    }
);

async function evaluarCapturaVFX(report) {
    if (!lastVisualCapture || visualReviewCycles >= MAX_VISUAL_REVIEW_CYCLES) return;
    if (Date.now() - lastVisualCapture.receivedAt > 90000) return;

    visualReviewCycles += 1;
    const capture = lastVisualCapture;
    const prompt = [
        "REVISIÓN VISUAL DEL EFECTO EN ROBLOX STUDIO.",
        "La imagen adjunta es una captura real del viewport actual.",
        "Evalúa solo lo que realmente se ve: silueta, composición, capas, contraste, escala, profundidad, legibilidad y objetos fuera de lugar.",
        "Si el efecto ya se ve coherente, devuelve actions: [].",
        "Si necesita mejoras, aplica cambios pequeños y concretos con acciones de instancias/propiedades; no crees scripts, remotes ni pruebas de juego.",
        "No borres objetos. No inventes detalles que no aparezcan en la captura.",
        `Resultado estructural reportado por Studio: ${report.successful} acciones correctas y ${report.failed} fallidas.`,
        "Devuelve JSON válido con reply y actions."
    ].join("\n");

    try {
        const texto = await preguntarOmniRoute(
            [
                { role: "system", content: VFX_SYSTEM },
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: capture.dataUrl } }
                    ]
                }
            ],
            {
                json: true,
                reasoningEffort: "none",
                reasoningFormat: "hidden",
                temperature: 0.1,
                maxCompletionTokens: 6000,
                timeoutMs: Math.min(Number(process.env.OMNIROUTE_TIMEOUT_MS || 120000), 120000),
                attemptsPerKey: 1
            }
        );

        const result = extraerResultado(texto, {
            repairMode: false,
            soloAnalisis: false,
            mensajeUsuario: "Revisión visual automática del VFX; no borrar objetos."
        });

        if (!result || result.actions.length === 0) {
            console.log("[RobloxAI] Revisión visual completada: no se solicitaron más cambios.");
            return;
        }

        pendingActions = result.actions;
        console.log(`[RobloxAI] Revisión visual ${visualReviewCycles}/${MAX_VISUAL_REVIEW_CYCLES}: ${pendingActions.length} ajuste(s) listos para Studio.`);
        console.log(result.reply || "Ajustes visuales preparados.");
    } catch (error) {
        console.warn("[RobloxAI] No se pudo evaluar la captura con el modelo configurado. Puede que el modelo seleccionado no admita imágenes:", error instanceof Error ? error.message : String(error));
    }
}

app.post(
    "/visual-capture",
    (req, res) => {
        const data = req.body || {};
        const imageBase64 = String(data.imageBase64 || "");
        if (!imageBase64 || imageBase64.length > 6000000 || !/^[A-Za-z0-9+/=]+$/.test(imageBase64)) {
            return res.status(400).json({ ok: false, error: "Captura PNG vacía, demasiado grande o inválida." });
        }
        lastVisualCapture = {
            dataUrl: `data:image/png;base64,${imageBase64}`,
            receivedAt: Date.now(),
            resolution: data.resolution || null
        };
        console.log("[RobloxAI] Captura visual recibida desde Studio.");
        return res.json({ ok: true });
    }
);
app.post(
    "/execution-results",
    (req, res) => {
        const data = req.body || {};
        const actions = Array.isArray(data.actions) ? data.actions.slice(0, 200) : [];
        lastExecutionReport = {
            receivedAt: new Date().toISOString(),
            requested: Math.max(0, Number(data.requested) || actions.length),
            successful: Math.max(0, Number(data.successful) || 0),
            failed: Math.max(0, Number(data.failed) || 0),
            actions
        };
        console.log(`[RobloxAI] Resultado Studio: ${lastExecutionReport.successful} correctas | ${lastExecutionReport.failed} fallidas.`);
        res.json({ ok: true });
        if (lastExecutionReport.successful > 0 && lastVisualCapture) {
            void evaluarCapturaVFX(lastExecutionReport);
        }
    }
);

app.get(
    "/health",
    (_req, res) => {
        const keys =
            String(
                process.env
                    .OMNIROUTE_API_KEY ||
                    ""
            )
                .split(",")
                .map(
                    (key) =>
                        key.trim()
                )
                .filter(Boolean);

        const individual =
            String(
                process.env
                    .OMNIROUTE_API_KEY ||
                    ""
            ).trim();

        if (
            individual &&
            !keys.includes(
                individual
            )
        ) {
            keys.unshift(
                individual
            );
        }

        res.json({
            ok: true,

            omnirouteConfigured:
                keys.length > 0,

            omnirouteKeys:
                keys.length,

            provider:
                "OmniRoute",

            model:
                OMNIROUTE_MODEL_ID,

            reasoningEffort:
                OMNIROUTE_CONFIG
                    .reasoningEffort,

            pendingActions:
                pendingActions.length,

            storedTestResults:
                testResults.size,

            activeTests:
                activeTestJobs.size
        });
    }
);

app.get(
    "/next",
    (_req, res) => {
        const actions =
            pendingActions;

        pendingActions = [];

        res.json({
            actions
        });
    }
);

/*
 * ============================================================
 * RESULTADOS DE TEST
 * ============================================================
 */

app.post(
    "/test-results",
    async (req, res) => {
        try {
            const data =
                req.body || {};

            const testId =
                String(
                    data.testId ||
                        ""
                ).trim();

            if (!testId) {
                return res
                    .status(400)
                    .json({
                        ok: false,
                        error:
                            "Falta testId"
                    });
            }

            const result = {
                ...data,

                testId,

                receivedAt:
                    new Date()
                        .toISOString()
            };

            testResults.set(
                testId,
                result
            );

            const errorCount =
                Array.isArray(
                    data.errors
                )
                    ? data.errors.length
                    : 0;

            const warningCount =
                Array.isArray(
                    data.warnings
                )
                    ? data.warnings.length
                    : 0;

            console.log(
                `[RobloxAI] 🧪 Resultado recibido: ${testId}`
            );

            console.log(
                `[RobloxAI] Estado: ${Boolean(
                    data.ok
                )}`
            );

            console.log(
                `[RobloxAI] Errores: ${errorCount}`
            );

            console.log(
                `[RobloxAI] Warnings: ${warningCount}`
            );

            const job =
                activeTestJobs.get(
                    testId
                );

            if (!job) {
                console.warn(
                    `[RobloxAI] ⚠️ Test no registrado: ${testId}`
                );

                return res.json({
                    ok: true,
                    received:
                        true,
                    testId,
                    tracked:
                        false
                });
            }

            if (
                data.ok === true &&
                errorCount === 0
            ) {
                console.log(
                    "✅ Sistema listo."
                );

                activeTestJobs.delete(
                    testId
                );

                return res.json({
                    ok: true,
                    received:
                        true,
                    testId,
                    finished:
                        true
                });
            }

            if (
                job.ciclo >=
                MAX_TEST_CYCLES
            ) {
                console.error(
                    "❌ No se pudo resolver automáticamente después de 3 ciclos."
                );

                activeTestJobs.delete(
                    testId
                );

                return res.json({
                    ok: true,
                    received:
                        true,
                    testId,
                    finished:
                        true,
                    maxCyclesReached:
                        true
                });
            }

            console.log(
                "❌ Se encontró un error."
            );

            console.log(
                "🧠 Analizando la causa..."
            );

            const siguienteCiclo =
                job.ciclo + 1;

            console.log(
                `🔧 Corrigiendo... ciclo ${siguienteCiclo}/${MAX_TEST_CYCLES}`
            );

            const correction =
                await pedirCorreccion(
                    job.mensajeOriginal,
                    result
                );

            if (
                !correction ||
                correction.actions
                    .length === 0
            ) {
                console.error(
                    "❌ No se generó una corrección ejecutable."
                );

                activeTestJobs.delete(
                    testId
                );

                return res.json({
                    ok: true,
                    received:
                        true,
                    testId,
                    finished:
                        true,
                    correctionFailed:
                        true
                });
            }

            const newTests =
                obtenerTestsDeAcciones(
                    correction.actions
                );

            if (
                newTests.length ===
                0
            ) {
                console.error(
                    "❌ La corrección no incluyó una nueva prueba."
                );

                activeTestJobs.delete(
                    testId
                );

                return res.json({
                    ok: true,
                    received:
                        true,
                    testId,
                    finished:
                        true,
                    retestMissing:
                        true
                });
            }

            pendingActions =
                correction.actions;

            activeTestJobs.delete(
                testId
            );

            registrarTests(
                job.mensajeOriginal,
                pendingActions,
                siguienteCiclo
            );

            console.log(
                "🧪 Nueva prueba preparada."
            );

            return res.json({
                ok: true,
                received:
                    true,
                testId,
                correctionStarted:
                    true,
                nextCycle:
                    siguienteCiclo,
                pendingActions:
                    pendingActions.length
            });
        } catch (error) {
            console.error(
                "❌ Error procesando /test-results:",
                error instanceof Error
                    ? error.message
                    : String(error)
            );

            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : String(
                                  error
                              )
                });
        }
    }
);

app.get(
    "/test-results/:testId",
    (req, res) => {
        const testId =
            String(
                req.params
                    .testId ||
                    ""
            );

        const result =
            testResults.get(
                testId
            );

        if (!result) {
            return res
                .status(404)
                .json({
                    ok: false,
                    error:
                        "Resultado no encontrado"
                });
        }

        return res.json(
            result
        );
    }
);

/*
 * ============================================================
 * SCRIPT SELECCIONADO
 * ============================================================
 */

app.post(
    "/selected-script",
    (req, res) => {
        const body =
            req.body;

        if (
            !body ||
            body.selected !==
                true
        ) {
            contextoScriptSeleccionado =
                null;

            return res.json({
                ok: true
            });
        }

        if (
            !SCRIPT_CLASSES.has(
                body.className
            ) ||
            typeof body.name !==
                "string" ||
            typeof body.path !==
                "string" ||
            typeof body.source !==
                "string"
        ) {
            return res
                .status(400)
                .json({
                    ok: false,
                    error:
                        "Script seleccionado inválido."
                });
        }

        contextoScriptSeleccionado = {
            className:
                body.className,

            name:
                body.name.trim(),

            path:
                body.path
                    .trim()
                    .replaceAll(
                        "\\",
                        "/"
                    ),

            source:
                body.source
        };

        return res.json({
            ok: true
        });
    }
);

/*
 * ============================================================
 * SERVIDOR
 * ============================================================
 */

app.listen(
    PORT,
    () => {
        console.log(
            "================================="
        );

        console.log(
            "🤖 ROBLOX AI BRIDGE — OMNIROUTE"
        );

        console.log(
            "================================="
        );

        console.log(
            `Servidor: http://127.0.0.1:${PORT}`
        );

        console.log(
            `Modelo: ${OMNIROUTE_MODEL_ID}`
        );

        console.log(
            "Reasoning: salida oculta"
        );

        console.log(
            "Funciones: creación y refinamiento de VFX mediante instancias y propiedades en Studio"
        );

        console.log(
            "Modo especializado: VFX/PFX; no programación general."
        );

        console.log(
            "=================================\n"
        );
    }
);

const rl =
    readline.createInterface({
        input:
            process.stdin,

        output:
            process.stdout
    });

console.log(
    "Describe el VFX que quieres crear o mejorar. Escribe 'salir' para cerrar.\n"
);

while (true) {
    const mensaje =
        await rl.question(
            "Tú: "
        );

    const texto =
        mensaje.trim();

    if (!texto) {
        continue;
    }

    if (
        texto.toLowerCase() ===
        "salir"
    ) {
        break;
    }

    if (
        esTareaProyecto(
            texto
        )
    ) {
        await procesarVFX(
            texto,
            esSoloAnalisis(
                texto
            )
        );
    } else {
        await responderChat(
            texto
        );
    }
}

rl.close();

process.exit(0);

