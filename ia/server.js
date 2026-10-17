
import "dotenv/config";
import express from "express";
import readline from "readline/promises";
import {
	installDiagnosticLogging,
	installFatalErrorHandlers,
	requestIdMiddleware,
	expressErrorMiddleware,
	logError
} from "./diagnostics.js";
import {
	existsSync,
	readFileSync,
	writeFileSync,
	appendFileSync,
	readdirSync,
	statSync,
	renameSync,
	mkdirSync
} from "node:fs";
import path from "node:path";

import {
	OMNIROUTE_CONFIG,
	OMNIROUTE_MODEL_ID,
	preguntarOmniRoute,
	parsearRespuestaJson
} from "./omniRoute.js";

const app = express();
installDiagnosticLogging("RobloxAI");
installFatalErrorHandlers("RobloxAI");

app.use(requestIdMiddleware);
app.use(
	express.json({
		limit: "8mb"
	})
);
// Captura errores del parser JSON antes de que lleguen a las rutas.
app.use(expressErrorMiddleware("RobloxAI"));

const PORT = Number(
	process.env.PORT || 3000
);

const PROJECT_CONTEXT_PORT = Number(
	process.env.PROJECT_CONTEXT_PORT || 3001
);

let pendingActions = [];
let lastExecutionReport = null;
let lastVisualCapture = null;
let referenciaVisualActual = null;
let visualReviewCycles = 0;
const MAX_VISUAL_REVIEW_CYCLES = 2;

// Guarda únicamente el texto devuelto por la revisión visual para depurar respuestas
// que no respeten JSON. El archivo local está excluido de Git y no incluye imágenes.
const RUTA_DEBUG_REVISION_VISUAL = path.resolve(
	process.cwd(),
	"visual-review-debug.txt"
);
const MAX_CARACTERES_DEBUG_REVISION = 40000;

function guardarRespuestaRevisionVisual(etapa, respuesta, modelo = "") {
	const respuestaCompleta = String(respuesta ?? "");
	const respuestaGuardada = respuestaCompleta.length > MAX_CARACTERES_DEBUG_REVISION
		? respuestaCompleta.slice(0, MAX_CARACTERES_DEBUG_REVISION) +
			"\n[RESPUESTA RECORTADA PARA EL ARCHIVO DE DIAGNÓSTICO]"
		: respuestaCompleta;

	try {
		// Evita que el archivo de depuración crezca indefinidamente.
		if (
			existsSync(RUTA_DEBUG_REVISION_VISUAL) &&
			statSync(RUTA_DEBUG_REVISION_VISUAL).size > 900000
		) {
			writeFileSync(RUTA_DEBUG_REVISION_VISUAL, "", "utf8");
		}

		const bloque = [
			"",
			"============================================================",
			"Fecha: " + new Date().toISOString(),
			"Etapa: " + String(etapa || "desconocida"),
			"Modelo: " + String(modelo || "(modelo predeterminado)"),
			"Longitud original: " + respuestaCompleta.length + " caracteres",
			"RESPUESTA ORIGINAL DEL MODELO:",
			"------------------------------------------------------------",
			respuestaGuardada || "(respuesta vacía)",
			"============================================================",
			""
		].join("\n");

		appendFileSync(RUTA_DEBUG_REVISION_VISUAL, bloque, "utf8");
	} catch (error) {
		console.warn(
			"[RobloxAI] No se pudo guardar la respuesta de revisión visual:",
			error instanceof Error ? error.message : String(error)
		);
	}
}

let contextoScriptSeleccionado = null;
let contextoProyectoActual = null;

const historial = [];
const testResults = new Map();
const activeTestJobs = new Map();
const visualAnalysisCache = new WeakMap();

const MAX_TEST_CYCLES = 3;
const MAX_VFX_ACTIONS = 120;
// Empty by default: a vision model must exist in the user's OmniRoute catalog.
const OMNIROUTE_VISION_MODEL = String(
	process.env.OMNIROUTE_VISION_MODEL || ""
).trim();

const NVIDIA_VISION_URL = String(
	process.env.NVIDIA_VISION_URL ||
	"https://integrate.api.nvidia.com/v1/chat/completions"
).trim();

const NVIDIA_VISION_MODEL = String(
	process.env.NVIDIA_VISION_MODEL ||
	"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
).trim();

const NVIDIA_VISION_FALLBACK_MODEL = String(
	process.env.NVIDIA_VISION_FALLBACK_MODEL ||
	"meta/llama-3.2-11b-vision-instruct"
).trim();

const NVIDIA_VISION_TIMEOUT_MS = Math.max(
	10000,
	Number(process.env.NVIDIA_VISION_TIMEOUT_MS || 90000)
);

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
"VFX SIN REFERENCIA Y PLAN DE RESPALDO:",
"Cuando el usuario describe un efecto solo con texto y no adjunta una imagen, prioriza construirlo directamente con Parts, Attachments, ParticleEmitters, Beams, Trails y luces nativas de Roblox. No emitas buscar_texturas solo porque una textura podría mejorar el resultado; busca en el catálogo únicamente si el usuario pide usar un recurso del catálogo o si el elemento visual imprescindible no puede representarse razonablemente con instancias nativas.",
"Si una búsqueda de recursos devuelve cero resultados, no canceles el trabajo, no repitas la búsqueda y no afirmes que el efecto está creado. Continúa con un diseño alternativo usando geometría y propiedades nativas. Nunca inventes asset IDs.",
"Para sangre estilizada de videojuego, construye una composición deliberada de salpicaduras, gotas y chorreaduras con Parts rojas de distintos tamaños y orientaciones; usa ParticleEmitter tintado con textura interna documentada solo si está disponible y sirve al diseño. No dependas de encontrar una textura externa.",
"",
"FLUJO DE TRABAJO:",
"1 Interpreta el efecto pedido y planifica sus capas",
"2 Revisa el contexto real del proyecto y reutiliza solo objetos relevantes que existan de verdad",
"3 Crea y configura las instancias directamente mediante actions",
"4 Mantén todo organizado bajo una carpeta o modelo con un nombre claro",
"5 Informa qué se creó, qué falló y qué no se pudo comprobar",
"No afirmes que el efecto se ve bien si no recibiste una captura visual verificable",
"",
"INSTANCIAS:",
"Usa create_instance con path (ruta del contenedor padre), name, className y properties",
"Puedes crear instancias Roblox válidas como Folder, Model, Part, Attachment, ParticleEmitter, Beam, Trail, PointLight y otras clases válidas",
"Crea las instancias padre antes que sus descendientes Para rutas nuevas, el bridge puede crear carpetas contenedoras; no inventes que una acción se aplicó si el resultado del bridge no lo confirma",
"Usa set_property/set_properties para modificar objetos existentes Usa move_instance para cambiar el padre; nunca simules Parent como una propiedad",
"No borres objetos existentes ajenos al efecto solicitado No reemplaces sistemas de juego ni edites scripts de gameplay salvo que el usuario lo pida explícitamente",
"",
"VALORES TIPADOS PARA PROPIEDADES:",
"Vector2: {type:'Vector2',x:0,y:0}",
"Vector3: {type:'Vector3',x:0,y:0,z:0}",
"Color3: {type:'Color3',r:01,g:05,b:1} con canales de 0 a 1",
"CFrame: {type:'CFrame',x:0,y:0,z:0,rx:0,ry:0,rz:0} con rotaciones en grados",
"NumberRange: {type:'NumberRange',min:0,max:1}",
"NumberSequence: {type:'NumberSequence',keypoints:[{time:0,value:0},{time:1,value:1}]}",
"ColorSequence: {type:'ColorSequence',keypoints:[{time:0,color:{r:1,g:1,b:1}},{time:1,color:{r:0,g:05,b:1}}]}",
"Para NumberSequence y ColorSequence usa al menos dos keypoints, tiempos entre 0 y 1 y ordenados de menor a mayor",
"Enum: {type:'Enum',enum:'Material',value:'Neon'}",
"EmissionDirection de ParticleEmitter NO tiene enum propio: es Enum.NormalId y se envia {type:'Enum',enum:'NormalId',value:'Top'} con valores Top, Bottom, Front, Back, Left, Right. Enum.EmissionDirection no existe",
"No envíes NumberSequence, ColorSequence o NumberRange como cadenas de texto; usa los objetos tipados descritos arriba",
"",
"LÍMITES ACTUALES:",
"El bridge puede aplicar acciones y comprobar estructura/propiedades, y dispone de un bucle de revisión mediante una PROYECCIÓN SINTÉTICA. No es una captura del viewport renderizado y no permite verificar sombras, texturas reales ni partículas simuladas.",
"No digas que capturaste una imagen, inspeccionaste el viewport, ejecutaste una animación o validaste la calidad visual si no hay evidencia real de ello",
"Para una primera versión, prioriza efectos editables y visibles en el viewport de Studio sin pulsar Play No uses run_studio_test como requisito para un efecto estático de edición",
"",
"SALIDA:",
"Devuelve UN SOLO objeto JSON válido con exactamente reply y actions",
"Sin markdown ni texto fuera del JSON",
"actions debe contener solamente acciones compatibles con el bridge",
"Si el usuario pidió solo analizar/revisar, devuelve actions: []",
"No afirmes que una acción se aplicó o probó si el bridge no lo confirmó",
"TEXTURAS:",
"Un ParticleEmitter con Texture vacia o con un asset que NO existe no dibuja nada, aunque este Enabled y con Rate alto",
"NUNCA inventes un rbxassetid:// Un id inventado deja el efecto invisible y no da error",
"FUENTES VALIDAS, en orden de preferencia.",
"1) El CATALOGO DE TEXTURAS VERIFICADAS que recibes en el mensaje de usuario. Es la fuente principal: contiene las texturas ya presentes en el proyecto y las encontradas en el catalogo publico de Roblox para esta consulta.",
"2) Accion especial buscar_texturas cuando la peticion necesita una textura que no esta en el catalogo recibido. Responde con {\"type\":\"buscar_texturas\",\"keyword\":\"...\",\"motivo\":\"...\"} y ESPERA el resultado: el bridge busca en el catalogo publico de Roblox, valida cada id en Studio y te devuelve solo las que cargan de verdad.",
"2b) Si lo que falta es una FORMA completa que no sabes construir con Parts (humo con volumen, telaraña, cristal, hierba, arma, armadura), añade \"tipo\":\"modelo\" a buscar_texturas. El servidor valida en Studio que los candidatos carguen y contengan objetos visuales, compara miniaturas con la referencia cuando hay modelo visual disponible y solo inserta un candidato con evidencia suficiente. Cargar un modelo no demuestra que sea visualmente parecido. Tu NUNCA emitas insertar_modelo: la inserta el bridge.",
"3) Cualquier assetId que el usuario te indique.",
"4) Ultimo recurso, las internas del motor: rbxasset://textures/particles/fire_maindds (fuego), smoke_maindds (humo), sparkles_maindds (chispas).",
"El bridge comprueba cada textura de verdad y RECHAZA la accion si el asset no existe, asi que no intentes colarla",
"Usa buscar_texturas como primera acción solo cuando el recurso externo sea realmente necesario según las reglas anteriores; no lo uses como paso predeterminado para efectos construibles con instancias nativas. Si buscas, no inventes resultados ni IDs.",
"",
"BUSQUEDA Y REUTILIZACION PARA UNA IMAGEN DE REFERENCIA:",
"Antes de crear un VFX entero desde cero, examina la estructura visual real de los recursos existentes que aparecen en el contexto. Reutiliza un recurso solo si su geometría, propiedades y jerarquía pueden adaptarse a la silueta de la referencia; no confíes únicamente en el nombre.",
"Si no hay un VFX existente ni un conjunto de recursos adaptables que conserve los rasgos principales de la referencia, emite buscar_texturas como PRIMERA acción, con palabras clave visuales específicas. Usa tipo=modelo cuando lo que falte sea una forma/VFX completa; para una textura, usa una palabra clave que describa el elemento concreto que se necesita.",
"Si la referencia contiene letras estilizadas, números, runas, glifos, sigilos, símbolos o marcas extrañas, descríbelos explícitamente como elementos principales de la composición: silueta, orientación, disposición, grosor de trazo, espacios vacíos, color y relación con las capas de energía.",
"Cuando esos símbolos sean importantes y falte un recurso adecuado, puedes emitir hasta DOS acciones buscar_texturas en la respuesta inicial: una de tipo textura con búsqueda concreta de decal/glifo y otra de tipo modelo con búsqueda de efecto/símbolo mágico completo si aporta geometría reutilizable. No mezcles acciones de creación en esa primera respuesta de búsqueda; espera los resultados y después combínalos.",
"No insertes resultados a ciegas: usa el decal/modelo encontrado solo si su miniatura, nombre y estructura dan evidencia de que encaja. Combínalo con geometría 3D independiente, trazos/partes, aros o capas de energía y partículas según la imagen; no dejes que un solo decal plano sustituya todo el efecto.",
"Si no existe un glifo que coincida, conserva la composición mediante contornos y trazos de geometría compatibles; si el texto es legible y ayuda a la referencia, también puedes usar TextLabel en un BillboardGui o SurfaceGui sobre una parte de anclaje. No inventes un símbolo desconocido ni afirmes que es idéntico.",
"Espera el resultado de la búsqueda. Si hay miniaturas y visión disponibles, los candidatos se ordenan por semejanza visual; los modelos también se validan en Studio antes de insertarse. No afirmes que se encontró algo parecido si no hay evidencia, y no insertes un modelo solo porque se pueda cargar. Si no aparece un candidato adecuado, construye el efecto con geometría y recursos útiles disponibles.",
"",
"COMO REPRODUCIR UNA IMAGEN DE REFERENCIA:",
"Si el contexto incluye un ANALISIS VISUAL DE LA IMAGEN, el efecto debe parecerse a esa imagen por su FORMA, no solo por su brillo. Una figura plana (anillo, disco, espiral, estrella, lamina) NO se resuelve con particulas sueltas.",
"1) Lee el bloque ESTRUCTURA / PLANO / PALETA / PARTICULAS del analisis. La silueta manda sobre todo lo demas. Usa sus cifras relativas (diametros, proporcion entre capas, posicion en la escena) para decidir tamanos y distancias reales.",
"2) Construye esa silueta con geometria real de Parts ANTES de las particulas:",
"   - figura plana tumbada en el suelo (anillo, circulo, disco, espiral, estrella): un Part Anchored por capa con Size = Vector3 (D, G, D), siendo D el diametro que diga el analisis y G un grosor fino. El eje fino es Y solo cuando la figura realmente es horizontal; para figuras verticales usa la orientación deducida de la referencia.",
"     Ese Part va con Transparency = 1, CanCollide = false y Material = SmoothPlastic. Quien dibuja la figura es un Decal DENTRO del Part, nunca la Part en si.",
"     El Decal es obligatorio cuando la figura se dibuja con una textura: Face = Top (Enum.NormalId.Top) si la figura mira hacia arriba, o Front/Back si mira de lado; Texture del catalogo y Color3 con el color dominante de la imagen. Sin ese Decal la figura no dibuja absolutamente nada.",
"     Elige la textura por lo que representa visualmente, NUNCA por el nombre de su carpeta: las carpetas del catalogo indican DONDE se usa cada textura en el proyecto, no QUE es la textura. Si ninguna textura del catalogo representa la figura que pide el analisis, emite buscar_texturas como PRIMERA accion con un keyword descriptivo (anillo, circulo, espiral, estrella, rayo, humo, telaraña, cristal) y espera el resultado verificado.",
"   - varias capas concentricas o paralelas: un Part plano por capa, TODAS con el MISMO centro en X y Z, con los diametros y las alturas que diga el analisis, no todas a la misma altura salvo que el analisis lo indique.",
"   - figura de pie o vertical (columna, cinta, rayo, llama): Part alargado con la misma paleta, apoyado en el suelo o en el punto que indique el analisis.",
"   - PROHIBIDO resolver una figura plana con una esfera, una bola de luz, un Material ForceField o un SpecialMesh esferico: eso destruye la silueta. La figura se construye con Parts planos con Decal, y las particulas solo van ENCIMA, nunca en su lugar.",
"3) Respeta el PLANO del análisis. No asumas una coordenada fija de suelo. Si dice suelo, identifica la superficie de apoyo real en el contexto del proyecto y calcula su cara superior usando posición y tamaño; coloca la figura apenas por encima para evitar z-fighting. Si dice vertical o libre, respeta ese plano y no fuerces el efecto al suelo.",
"4) Usa la PALETA observada: color dominante en Decal.Color3 y en ParticleEmitter.Color, acento en el nucleo y en PointLight.Color.",
"5) Solo despues anade las particulas: un Attachment por cada zona del analisis (centro, borde, nucleo, base), ParticleEmitter con lo que el analisis diga que emite cada zona, y una PointLight del color del nucleo. Las particulas acompanan a la geometria, nunca la sustituyen.",
"6) Si el proyecto ya tiene un efecto parecido en Workspace, revisa su ESTRUCTURA REAL (Partes, Decals, emisores y sus propiedades) y trabaja sobre ese en vez de duplicarlo. El nombre de un objeto no indica si sirve.",
"7) Tras construir, el bridge envía una proyección sintética y un resumen de propiedades. Usa ambos para buscar diferencias de forma, tamaño, posición y paleta, pero NO afirmes haber visto el render real ni juzgues texturas o sombras reales. No inventes ajustes para detalles que la representación no pueda mostrar.",


"JERARQUIA OBLIGATORIA:",
"ParticleEmitter, Beam, Trail, Fire, Smoke y Sparkles SOLO funcionan si su PADRE DIRECTO es un BasePart (Part/MeshPart/WedgePart) o un Attachment. Dentro de un Folder o un Model no emiten nada",
"PointLight, SpotLight y SurfaceLight tambien deben ser hijas DIRECTAS de un BasePart o de un Attachment. Una luz dentro de un Folder no ilumina nada",
"Un Folder sirve para organizar, nunca como padre de un emisor o de una luz.",
"Estructura correcta: Model \"NombreVFX\" > Part \"Core\" > Attachment \"CoreAtt\" > ParticleEmitter y PointLight",
"Las Parts de anclaje van con Anchored=true, CanCollide=false y Transparency=1",
"Coloca el efecto en la posicion real del objeto de destino. No lo dejes en 0,0,0 ni bajo el mapa",
"Al crear un ParticleEmitter incluye SIEMPRE la propiedad Texture en la misma accion; el bridge rechaza crearlo sin textura",
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
								* TEXTURAS: CATÁLOGO DEL PROYECTO Y BÚSQUEDA EN EL CATÁLOGO DE ROBLOX
								* Studio no puede consultar internet (HttpService tiene bloqueados los
									* dominios de Roblox), así que la búsqueda se hace aquí y la
								* verificación real se hace en Studio con ContentProvider.
								* ============================================================
								*/

								const RUTA_CACHE_TEXTURAS = path.resolve(
									process.cwd(),
									"vfx-texture-cache.json"
								);

								const MAX_TEXTURAS_POR_CATEGORIA = 12;
								const MAX_BUSQUEDAS_CACHE = 120;
								const MAX_CANDIDATOS_BUSQUEDA = 16;

								let catalogoTexturasProyecto = [];
								const esperasTexturas = new Map();
const esperasModelos = new Map();

								function leerCacheTexturas() {
									try {
										if (!existsSync(RUTA_CACHE_TEXTURAS)) {
											return { project: [], searches: [] };
										}

										const datos = JSON.parse(
											readFileSync(RUTA_CACHE_TEXTURAS, "utf8")
										);

										return {
											project: Array.isArray(datos?.project) ? datos.project : [],
											searches: Array.isArray(datos?.searches) ? datos.searches : []
										};
									} catch (error) {
										console.warn(
											"⚠️ Caché de texturas ilegible, se ignora:",
											error instanceof Error ? error.message : String(error)
										);
										return { project: [], searches: [] };
									}
									}

									function guardarCacheTexturas(cache) {
										try {
											writeFileSync(
												RUTA_CACHE_TEXTURAS,
												JSON.stringify(cache),
												"utf8"
											);
										} catch (error) {
											console.warn(
												"⚠️ No se pudo guardar la caché de texturas:",
												error instanceof Error ? error.message : String(error)
											);
										}
										}

										const cacheTexturas = leerCacheTexturas();

										catalogoTexturasProyecto = cacheTexturas.project
										.filter(
											(textura) =>
											textura && typeof textura.id === "string"
										)
										.slice(0, 400);

										function claveBusqueda(keyword) {
											return String(keyword || "")
											.toLowerCase()
											.replace(/\s+/g, " ")
											.trim()
											.slice(0, 80);
											}

											function normalizarIdTextura(valor) {
												const limpio = String(valor || "")
												.replace(/^rbxassetid:\/\//i, "")
												.trim();

												return /^\d+$/.test(limpio) ? limpio : null;
												}

												async function pedirJson(url, timeoutMs = 12000, headersExtra = {}) {
	try {
		const response = await fetch(url, {
			headers: { Accept: "application/json", ...headersExtra },
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!response.ok) {
			let host = "invalid-url";
			try { host = new URL(url).host; } catch {}
			console.warn(`[RobloxAI] Catálogo externo respondió HTTP ${response.status} (${host}); se probará otro proveedor.`);
			return null;
		}
		return await response.json();
	} catch (error) {
		let host = "invalid-url";
		try { host = new URL(url).host; } catch {}
		logError("RobloxAI", "external.json_fetch_failed", error, { host, timeoutMs });
		return null;
	}
}

												function itemsDeRespuestaCatalogo(datos) {
	const formas = [
		datos?.data,
		datos?.items,
		datos?.Items,
		datos?.results,
		datos?.Results,
		datos?.assets,
		datos?.Assets,
		datos?.data?.items,
		datos?.data?.assets
	];
	for (const forma of formas) {
		if (Array.isArray(forma)) return forma;
	}
	return Array.isArray(datos) ? datos : [];
}

function idsDeCatalogoModerno(datos, tipoEsperado = "Decal") {
	return itemsDeRespuestaCatalogo(datos)
		.map((entrada) => {
			const item = entrada?.asset && typeof entrada.asset === "object"
				? { ...entrada, ...entrada.asset }
				: entrada;
			const id = String(
				item?.id ?? item?.assetId ?? item?.AssetId ?? item?.asset_id ?? ""
			).trim();
			const nombre = String(item?.name ?? item?.Name ?? item?.title ?? "").trim();
			const tipoCrudo = item?.assetType?.name ?? item?.assetTypeName ??
				item?.assetType ?? item?.typeName ?? item?.category ?? "";
			const tipo = String(
				typeof tipoCrudo === "object" ? (tipoCrudo.name ?? tipoCrudo.value ?? "") : tipoCrudo
			).trim() || tipoEsperado;

			if (!/^\d+$/.test(id)) return null;
			return { id, nombre, tipo };
		})
		.filter(Boolean);
}

function idsDeCatalogoClasico(datos, tipoEsperado = "Decal") {
	return itemsDeRespuestaCatalogo(datos)
		.map((item) => {
			const id = String(
				item?.AssetId ?? item?.assetId ?? item?.assetID ??
				item?.asset_id ?? item?.id ?? item?.Id ?? ""
			).trim();
			const nombre = String(
				item?.Name ?? item?.name ?? item?.Title ?? item?.title ?? ""
			).trim();
			const tipoCrudo = item?.Type ?? item?.type ?? item?.assetType ?? tipoEsperado;
			const tipo = String(
				typeof tipoCrudo === "object" ? (tipoCrudo.name ?? tipoCrudo.value ?? "") : tipoCrudo
			).trim() || tipoEsperado;

			if (!/^\d+$/.test(id)) return null;
			return { id, nombre, tipo };
		})
		.filter(Boolean);
}

const ROBLOX_CREATOR_STORE_API_KEY = String(
	process.env.ROBLOX_CREATOR_STORE_API_KEY || ""
).trim();

const proveedorCreatorStore = (tipoEsperado) => ({
	nombre: `Creator Store API (${tipoEsperado})`,
	url: (keyword) => {
		const categoria = tipoEsperado === "Modelo" ? "Model" : "Decal";
		return `https://apis.roblox.com/toolbox-service/v2/assets:search?searchCategoryType=${categoria}&query=${encodeURIComponent(keyword)}&maxPageSize=30`;
	},
	headers: ROBLOX_CREATOR_STORE_API_KEY
		? { "x-api-key": ROBLOX_CREATOR_STORE_API_KEY }
		: {},
	leer: (datos) => idsDeCatalogoModerno(datos, tipoEsperado).map((item) => ({ ...item, tipo: tipoEsperado }))
});

const PROVEEDORES_CATALOGO = [
	...(ROBLOX_CREATOR_STORE_API_KEY ? [proveedorCreatorStore("Decal")] : []),
	{
		nombre: "Creator Store legacy (Decals)",
		url: (keyword) =>
			`https://search.roblox.com/catalog/json?Category=Decals&Keyword=${encodeURIComponent(keyword)}&SortType=0&ResultsPerPage=40&PageNumber=1`,
		leer: (datos) => idsDeCatalogoClasico(datos, "Decal").map((item) => ({ ...item, tipo: "Decal" }))
	},
	{
		nombre: "Creator Store legacy (Decals, actualizados)",
		url: (keyword) =>
			`https://search.roblox.com/catalog/json?Category=Decals&Keyword=${encodeURIComponent(keyword)}&SortType=3&ResultsPerPage=40&PageNumber=1`,
		leer: (datos) => idsDeCatalogoClasico(datos, "Decal").map((item) => ({ ...item, tipo: "Decal" }))
	}
];

const PROVEEDORES_MODELOS = [
	...(ROBLOX_CREATOR_STORE_API_KEY ? [proveedorCreatorStore("Modelo")] : []),
	{
		nombre: "Creator Store legacy (Models)",
		url: (keyword) =>
			`https://search.roblox.com/catalog/json?Category=Models&Keyword=${encodeURIComponent(keyword)}&SortType=0&ResultsPerPage=40&PageNumber=1`,
		leer: (datos) => idsDeCatalogoClasico(datos, "Modelo").map((item) => ({ ...item, tipo: "Modelo" }))
	},
	{
		nombre: "Creator Store legacy (Models, actualizados)",
		url: (keyword) =>
			`https://search.roblox.com/catalog/json?Category=Models&Keyword=${encodeURIComponent(keyword)}&SortType=3&ResultsPerPage=40&PageNumber=1`,
		leer: (datos) => idsDeCatalogoClasico(datos, "Modelo").map((item) => ({ ...item, tipo: "Modelo" }))
	}
];

function variantesBusquedaCatalogo(keyword, tipo = "textura") {
	const clave = claveBusqueda(keyword);
	if (!clave) return [];

	const variantes = [clave];
	const esSimbolo = /(?:letra|letter|símbol|simbol|symbol|runa|rune|glyph|glifo|sigil|sello|magic circle|círculo mágico|circulo magico|runic|runes|glyphs)/i.test(clave);

	if (esSimbolo) {
		if (tipo === "modelo") {
			variantes.push("magic circle VFX", "rune magic effect", "glowing symbol effect");
		} else {
			variantes.push("rune symbol decal", "magic circle decal", "glowing glyph");
		}
	} else if (tipo === "modelo") {
		variantes.push(`${clave} VFX`, `${clave} particle effect`, `${clave} visual effect`);
	} else {
		variantes.push(`${clave} decal`, `${clave} particle texture`, `${clave} VFX texture`);
	}

	const unicas = [];
	const vistas = new Set();
	for (const variante of variantes) {
		const limpia = claveBusqueda(variante);
		const id = limpia.toLowerCase();
		if (limpia && !vistas.has(id)) {
			vistas.add(id);
			unicas.push(limpia);
		}
		if (unicas.length >= 4) break;
	}
	return unicas;
}

async function buscarEnCatalogoRoblox(keyword, tipo = "textura") {
	const esModelo = tipo === "modelo";
	const proveedores = esModelo ? PROVEEDORES_MODELOS : PROVEEDORES_CATALOGO;
	const variantes = variantesBusquedaCatalogo(keyword, tipo);
	if (variantes.length === 0) return [];

	// Ejecuta variantes independientes en paralelo para que una búsqueda lenta no bloquee las demás.
	const resultadosPorVariante = await Promise.all(
		variantes.map(async (clave) => {
			for (const proveedor of proveedores) {
				const datos = await pedirJson(proveedor.url(clave), 9000, proveedor.headers || {});
				const encontrados = proveedor.leer(datos);
				if (encontrados.length > 0) {
					const permitidos = encontrados.filter((item) => {
						const tipoItem = String(item.tipo || "").toLowerCase();
						if (esModelo) return !tipoItem || tipoItem.includes("modelo") || tipoItem === "model";
						return !tipoItem || tipoItem.includes("decal") || tipoItem.includes("image");
					});
					if (permitidos.length > 0) {
						return { clave, proveedor: proveedor.nombre, encontrados: permitidos };
					}
				}
			}
			return { clave, proveedor: "", encontrados: [] };
		})
	);

	const candidatos = [];
	const vistos = new Set();
	const maxPorVariante = Math.max(2, Math.ceil(MAX_CANDIDATOS_BUSQUEDA / variantes.length));
	for (const resultado of resultadosPorVariante) {
		let agregadosDeEstaVariante = 0;
		for (const item of resultado.encontrados) {
			const id = String(item.id || "").trim();
			if (!/^\d+$/.test(id) || vistos.has(id)) continue;
			vistos.add(id);
			candidatos.push({
				id,
				nombre: String(item.nombre || "").trim(),
				tipo: esModelo ? "Modelo" : "Decal"
			});
			agregadosDeEstaVariante += 1;
			if (agregadosDeEstaVariante >= maxPorVariante || candidatos.length >= MAX_CANDIDATOS_BUSQUEDA) break;
		}
		if (candidatos.length >= MAX_CANDIDATOS_BUSQUEDA) break;
	}

	if (candidatos.length > 0) {
		const proveedoresUsados = [...new Set(resultadosPorVariante.filter((r) => r.encontrados.length > 0).map((r) => r.proveedor))];
		console.log(
			`[RobloxAI] 🔎 Catálogo Creator Store (${proveedoresUsados.join(", ")}): ${candidatos.length} candidatos para "${claveBusqueda(keyword)}" tras ${variantes.length} búsqueda(s).`
		);
		return candidatos;
	}

	const avisoApi = ROBLOX_CREATOR_STORE_API_KEY
		? ""
		: " La API moderna de Creator Store está desactivada porque falta ROBLOX_CREATOR_STORE_API_KEY en ia/.env; se intentaron los endpoints de respaldo.";
	console.warn(
		`[RobloxAI] Creator Store no devolvió candidatos para "${claveBusqueda(keyword)}" tras ${variantes.length} búsqueda(s) y ${proveedores.length} proveedor(es).` + avisoApi
	);
	return [];
}

function esperarVerificacionTexturas(
																	requestId,
																	timeoutMs
																) {
																	return new Promise((resolve) => {
																		const timer = setTimeout(() => {
																			esperasTexturas.delete(requestId);
																			// No dejar una verificación vencida en la cola por si Studio no la recogió.
																			const indicePendiente = pendingActions.findIndex(
																				(accion) => String(accion?.requestId || "") === String(requestId)
																			);
																			if (indicePendiente >= 0) pendingActions.splice(indicePendiente, 1);
																			resolve(null);
																		}, timeoutMs);

																		esperasTexturas.set(requestId, (results) => {
																			clearTimeout(timer);
																			resolve(results);
																		});
																	});
																	}

																	async function verificarTexturasEnStudio(candidatos) {
																		if (candidatos.length === 0) {
																			return [];
																		}

																		const requestId = `tex_${Date.now().toString(36)}_${Math.random()
																		.toString(36)
																		.slice(2, 8)}`;

																		const espera = esperarVerificacionTexturas(requestId, 60000);

																		pendingActions.push({
																			type: "verify_textures",
																			requestId,
																			textures: candidatos.map((item) => ({
																				id: item.id,
																				nombre: item.nombre,
																				categoria: item.categoria
																			}))
																		});

																		const respuesta = await espera;

																		if (!Array.isArray(respuesta)) {
																			console.warn(
																				`[RobloxAI] TIEMPO DE ESPERA AGOTADO al validar texturas (${requestId}). Comprueba que el plugin actualizado esté conectado y que el servidor use el puerto 3000; no se marcarán candidatos como válidos.`
																			);
																			return null;
																		}

																			return respuesta
																			.filter(
																				(item) =>
																				item && item.carga === true && normalizarIdTextura(item.id)
																			)
																			.map((item) => ({
																				id: normalizarIdTextura(item.id),
																				nombre: String(item.nombre || "").trim(),
																				categoria: String(item.categoria || "").trim()
																			}));
																			}

	function esperarVerificacionModelos(requestId, timeoutMs) {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			esperasModelos.delete(requestId);
			// Evita que Studio reciba una verificación de modelos que ya venció.
			const indicePendiente = pendingActions.findIndex(
				(accion) => String(accion?.requestId || "") === String(requestId)
			);
			if (indicePendiente >= 0) pendingActions.splice(indicePendiente, 1);
			resolve(null);
		}, timeoutMs);
		esperasModelos.set(requestId, (results) => {
			clearTimeout(timer);
			resolve(results);
		});
	});
}

async function verificarModelosEnStudio(candidatos) {
	if (!Array.isArray(candidatos) || candidatos.length === 0) return [];
	const requestId = `model_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
	const espera = esperarVerificacionModelos(requestId, 60000);
	pendingActions.push({
		type: "verify_models",
		requestId,
		models: candidatos.slice(0, 6).map((item) => ({
			id: String(item.id),
			nombre: String(item.nombre || "")
		}))
	});
	const respuesta = await espera;
	if (!Array.isArray(respuesta)) {
		console.warn(`[RobloxAI] TIEMPO DE ESPERA AGOTADO al validar modelos (${requestId}). Comprueba que el plugin esté conectado; no se marcarán candidatos como válidos.`);
		return null;
	}
	return respuesta
		.filter((item) => item && item.validado === true && normalizarIdTextura(item.id))
		.map((item) => ({
			id: normalizarIdTextura(item.id),
			nombre: String(item.nombre || ""),
			validado: true,
			partes: Math.max(0, Number(item.partes) || 0),
			emisores: Math.max(0, Number(item.emisores) || 0)
		}));
}

async function obtenerMiniaturaCatalogo(assetId) {
	try {
		const metadata = await pedirJson(
			`https://thumbnails.roblox.com/v1/assets?assetIds=${encodeURIComponent(String(assetId))}&size=420x420&format=Png&isCircular=false`,
			8000
		);
		const item = Array.isArray(metadata?.data) ? metadata.data.find((candidate) => String(candidate?.targetId) === String(assetId)) : null;
		if (!item || item.state !== "Completed" || typeof item.imageUrl !== "string") return null;
		const response = await fetch(item.imageUrl, { signal: AbortSignal.timeout(8000) });
		if (!response.ok) return null;
		const mime = String(response.headers.get("content-type") || "image/png").split(";")[0];
		if (!/^image\/(png|jpeg|webp)$/i.test(mime)) return null;
		const bytes = Buffer.from(await response.arrayBuffer());
		if (!bytes.length || bytes.length > 1200000) return null;
		return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
	} catch (error) {
		logError("RobloxAI", "catalog.thumbnail_download_failed", error, { assetId: String(assetId) });
		return null;
	}
}

function ordenarModelosPorRelevanciaTextual(candidatos, keyword = "") {
	const normalizar = (valor) => String(valor || "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
	const ignorar = new Set([
		"vfx", "pfx", "effect", "effects", "model", "models", "modelo", "modelos",
		"asset", "assets", "roblox", "decal", "texture", "textures", "particle",
		"particles", "visual", "with", "from", "the", "and", "for", "of", "to",
		"de", "del", "para", "con", "una", "uno", "unos", "unas", "las", "los"
	]);
	const palabrasConsulta = [
		keyword,
		...variantesBusquedaCatalogo(keyword, "modelo")
	].join(" ");
	const tokens = [...new Set(normalizar(palabrasConsulta).split(" ").filter((token) =>
		token.length >= 3 && !ignorar.has(token)
	))];
	if (tokens.length === 0) {
		console.warn("[RobloxAI] No se puede ordenar modelos sin términos de búsqueda concretos.");
		return [];
	}

	const puntuados = candidatos.map((item, indice) => {
		const nombre = normalizar(item.nombre);
		const score = tokens.reduce((total, token) => total + (nombre.includes(token) ? 1 : 0), 0);
		return { item, indice, score };
	});
	const minimoDeCoincidencias = tokens.length > 1 ? 2 : 1;
	const mejores = puntuados.filter((entrada) => entrada.score >= minimoDeCoincidencias)
		.sort((a, b) => b.score - a.score || a.indice - b.indice)
		.map((entrada) => entrada.item);

	if (mejores.length === 0) {
		console.warn(`[RobloxAI] No se insertará un modelo sin similitud textual con la búsqueda "${keyword}"; se usará la alternativa de geometría VFX.`);
	}
	return mejores;
}

async function rankearCandidatosVisualmente(candidatos, tipo = "textura", keyword = "") {
	if (!Array.isArray(candidatos) || candidatos.length === 0) return [];
	if (candidatos.length < 2 && tipo !== "modelo") return candidatos;
	const referencia = referenciaVisualActual;
	if (!referencia || !String(process.env.NVIDIA_API_KEY || "").trim()) {
		console.log("[RobloxAI] Ranking visual de catálogo omitido: falta imagen de referencia o NVIDIA_API_KEY.");
		return tipo === "modelo" ? ordenarModelosPorRelevanciaTextual(candidatos, keyword) : candidatos;
	}

	// Limita las miniaturas para no saturar memoria/red ni el contexto multimodal.
	const candidatosCortos = candidatos.slice(0, 4);
	const miniaturas = await Promise.all(candidatosCortos.map(async (item) => ({
		item,
		miniatura: await obtenerMiniaturaCatalogo(item.id)
	})));
	const disponibles = miniaturas.filter((x) => x.miniatura);
	if (disponibles.length === 0 || (disponibles.length < 2 && tipo !== "modelo")) {
		console.warn("[RobloxAI] No hubo suficientes miniaturas del catálogo para una comparación visual fiable.");
		return tipo === "modelo" ? ordenarModelosPorRelevanciaTextual(candidatos, keyword) : candidatos;
	}

	const contenido = [
		{
			type: "text",
			text: [
				"IMAGEN OBJETIVO: la primera imagen es el VFX de referencia del usuario.",
				`CANDIDATOS: las imágenes siguientes son miniaturas de ${tipo === "modelo" ? "modelos" : "texturas/decal"} del catálogo público de Roblox. Búsqueda solicitada: "${keyword}".`,
				"Ordena por semejanza VISUAL con la referencia y relevancia para la característica buscada: silueta, forma, composición y color. Para texturas, compara principalmente la forma/elemento objetivo descrito por la palabra clave, no la imagen completa como una sola composición. No elijas solo por el nombre. El thumbnail puede ser una vista previa aproximada, no una captura completa del asset.",
				"Devuelve exclusivamente JSON con este formato: {\"ranking\":[{\"id\":\"ID_NUMERICO\",\"score\":0}]}. Incluye solo IDs mostrados; score de 0 a 100."
			].join("\n")
		},
		{ type: "image_url", image_url: { url: referencia } }
	];
	for (const candidato of disponibles) {
		contenido.push({
			type: "text",
			text: `Candidato ID=${String(candidato.item.id)}; nombre=${String(candidato.item.nombre || "(sin nombre)")}; tipo=${tipo}.`
		});
		contenido.push({ type: "image_url", image_url: { url: candidato.miniatura.dataUrl } });
	}
	const mensajes = [
		{ role: "system", content: "Eres un ranker de recuperación visual de assets. Compara imágenes reales de miniaturas con la imagen objetivo. No inventes IDs. Salida JSON estricta." },
		{ role: "user", content: contenido }
	];

	let respuesta;
	try {
		respuesta = await preguntarNvidiaVisionConReintento(mensajes);
	} catch (primaryError) {
		if (!NVIDIA_VISION_FALLBACK_MODEL || NVIDIA_VISION_FALLBACK_MODEL === NVIDIA_VISION_MODEL) {
			console.warn("[RobloxAI] Ranking visual falló.", primaryError instanceof Error ? primaryError.message : String(primaryError));
			return tipo === "modelo" ? ordenarModelosPorRelevanciaTextual(candidatos, keyword) : candidatos;
		}
		try {
			respuesta = await preguntarNvidiaVisionConReintento(mensajes, NVIDIA_VISION_FALLBACK_MODEL);
		} catch (fallbackError) {
			console.warn("[RobloxAI] Ranking visual y respaldo fallaron.", fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
			return tipo === "modelo" ? ordenarModelosPorRelevanciaTextual(candidatos, keyword) : candidatos;
		}
	}

	try {
		const limpio = String(respuesta || "").trim().replace(/^\uFEFF/, "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
		const json = limpio.match(/\{[\s\S]*\}/);
		if (!json) return tipo === "modelo" ? ordenarModelosPorRelevanciaTextual(candidatos, keyword) : candidatos;
		const parsed = JSON.parse(json[0]);
		const byId = new Map(candidatos.map((item) => [String(item.id), item]));
		const ordenados = [];
		const usados = new Set();
		const ranking = Array.isArray(parsed.ranking) ? parsed.ranking : [];
		const puntuaciones = new Map();
		ranking
			.filter((entry) => entry && byId.has(String(entry.id)) && Number.isFinite(Number(entry.score)))
			.sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
			.forEach((entry) => {
				const id = String(entry.id);
				puntuaciones.set(id, Math.max(0, Math.min(100, Number(entry.score))));
				if (!usados.has(id)) {
					usados.add(id);
					ordenados.push(byId.get(id));
				}
			});
		if (!ordenados.length) return tipo === "modelo" ? ordenarModelosPorRelevanciaTextual(candidatos, keyword) : candidatos;
		const mejorPuntuacion = puntuaciones.get(String(ordenados[0].id));
		if (tipo === "modelo" && Number.isFinite(mejorPuntuacion) && mejorPuntuacion < 35) {
			console.warn(`[RobloxAI] Ninguna miniatura de modelo pareció suficientemente similar a la referencia (mejor puntuación ${mejorPuntuacion}/100); no se insertará un modelo potencialmente irrelevante.`);
			return [];
		}
		for (const item of candidatos) {
			const id = String(item.id);
			if (!usados.has(id)) ordenados.push(item);
		}
		console.log(`[RobloxAI] Ranking visual del catálogo completado: mejor candidato ID ${ordenados[0].id} (${ordenados[0].nombre || "sin nombre"}).`);
		return ordenados;
	} catch (error) {
		console.warn("[RobloxAI] La respuesta del ranking visual no era JSON válido.", error instanceof Error ? error.message : String(error));
		return tipo === "modelo" ? ordenarModelosPorRelevanciaTextual(candidatos, keyword) : candidatos;
	}
}

async function buscarTexturasVerificadas(keyword, tipo = "textura") {
																		const clave = claveBusqueda(keyword);

																		if (!clave) {
																			return null;
																			}

																			const enCache = cacheTexturas.searches.find(
																				(entrada) => entrada && entrada.keyword === clave && entrada.tipo === tipo
																			);

																				if (
																					enCache &&
																					(tipo !== "modelo" || (Array.isArray(enCache.textures) && enCache.textures.length > 0 && enCache.textures.every((item) => item && item.validado === true))) &&
																					Date.now() - Number(enCache.at || 0) < 7 * 24 * 60 * 60 * 1000
																					) {
																						console.log(
																							`[RobloxAI] 💾 Texturas de "${clave}" recuperadas de la caché local.`
																						);
																						return enCache.textures;
																					}

																					const candidatos = await buscarEnCatalogoRoblox(clave, tipo);

																					if (candidatos.length === 0) {
																						return null;
																						}

																						const validadas = tipo === "modelo"
																							? await verificarModelosEnStudio(candidatos.slice(0, 6))
																							: await verificarTexturasEnStudio(candidatos);

																						if (!Array.isArray(validadas)) {
																							console.warn(`[RobloxAI] La búsqueda de ${tipo} encontró candidatos, pero Studio no respondió a la validación. Esto no significa que todos los assets sean inválidos.`);
																							return null;
																						}

																						if (validadas.length === 0) {
																							console.warn(`[RobloxAI] Studio respondió, pero ningún candidato de ${tipo} pasó la validación de carga.`);
																							return null;
																						}

																							const ordenadas = await rankearCandidatosVisualmente(validadas, tipo, clave);
																							const entrada = {
																								keyword: clave, tipo,
																								at: Date.now(),
																								textures: ordenadas.slice(0, 10)
																							};

																							cacheTexturas.searches = [
																							entrada,
																							...cacheTexturas.searches.filter(
																								(item) => item && (item.keyword !== clave || item.tipo !== tipo)
																							)
																							].slice(0, MAX_BUSQUEDAS_CACHE);

																							guardarCacheTexturas(cacheTexturas);

																							return entrada.textures;
																							}

																			function seccionTexturas(mensajeUsuario = "") {
																				const lineas = [];
																				const porCategoria = new Map();

																				for (const textura of catalogoTexturasProyecto) {
																					const id = normalizarIdTextura(textura.id);

																					if (!id) {
																						continue;
																						}

																						const categoria = textura.categoria || "Proyecto";

																						if (!porCategoria.has(categoria)) {
																							porCategoria.set(categoria, []);
																							}

																							const lista = porCategoria.get(categoria);
																							if (!lista.includes(id)) {
																								lista.push(id);
																								}
																								}

																					if (porCategoria.size > 0) {
																						lineas.push(
																							"CATÁLOGO DE TEXTURAS VERIFICADAS (ids que cargan de verdad en este proyecto; úsalos con el prefijo rbxassetid://):"
																						);

																						for (const [categoria, ids] of porCategoria) {
																							if (ids.length === 0) {
																								continue;
																							}

																							lineas.push(
																								`- ${categoria}: ${ids
																								.slice(0, MAX_TEXTURAS_POR_CATEGORIA)
																								.map((id) => `rbxassetid://${id}`)
																								.join(", ")}${ids.length > MAX_TEXTURAS_POR_CATEGORIA ? ", ..." : ""}`
																							);
																							}
																							} else {
	lineas.push(
		"CATÁLOGO DE TEXTURAS: todavía no se ha recibido el catálogo del proyecto desde Studio."
	);
	lineas.push(
		"Conecta el plugin de Roblox AI en Studio (envía el catálogo automáticamente) o pide texturas con la acción buscar_texturas."
	);
	}

	const palabras = claveBusqueda(mensajeUsuario)
	.split(" ")
	.filter((palabra) => palabra.length >= 4);

	const relevantes = cacheTexturas.searches
	.filter((entrada) => {
		if (!entrada || !entrada.keyword) {
			return false;
		}

		return claveBusqueda(entrada.keyword)
		.split(" ")
		.some((palabra) => palabras.includes(palabra));
	})
	.slice(0, 2);

	if (relevantes.length > 0) {
		lineas.push(
			"TEXTURAS YA BUSCADAS Y VERIFICADAS EN STUDIO PARA ESTA CONSULTA:"
		);

		for (const entrada of relevantes) {
			lineas.push(
				`- "${entrada.keyword}": ${entrada.textures
				.map((textura) => `rbxassetid://${textura.id}`)
				.join(", ")}`
			);
			}
			}

		return lineas.join("\n");
		}

	function textoResultadoBusquedaTexturas(keyword, texturas, tipo) {
	if (!texturas || texturas.length === 0) {
		const esModelo = tipo === "modelo";
		return [
		`BÚSQUEDA SIN RESULTADOS para "${keyword}".`,
		esModelo
		? "Ningún modelo encontrado en el catálogo de Studio cargó en Studio. No inventes ids de assets: crea el VFX con Parts o dilo con honestidad en tu respuesta."
		: "Ninguna textura encontrada cargó en Studio. No inventes ids: usa texturas del catálogo ya recibido o dilo con honestidad en tu respuesta."
		].join("\n");
	}

	if (tipo === "modelo") {
		return [
		`MODELOS DEL CATÁLOGO DE ROBLOX para "${keyword}" (se insertan en Studio desde el bridge; NO son tuyos, no los edites como si los hubieras creado):`,
		...texturas.map(
			(modelo) =>
			`- assetId ${modelo.id}${modelo.nombre ? ` (${modelo.nombre})` : ""}`
		),
		"Usa estos modelos como base visual (reescala, tiñe o copia sus Partículas). No inventes ningún otro assetId."
		].join("\n");
	}

	return [
	`TEXTURAS VERIFICADAS para "${keyword}" (comprobadas en Studio con ContentProvider; úsalas tal cual):`,
	...texturas.map(
		(textura) =>
		`- rbxassetid://${textura.id}${textura.nombre ? ` (${textura.nombre})` : ""}`
	),
	"No inventes ningún otro id. Si ninguna de estas encaja con el efecto, dilo en tu respuesta en lugar de inventar."
	].join("\n");
	}

		/*
		* ============================================================
		* CONSTRUCCIÓN DEL CONTEXTO
		* ============================================================
		*/

	/*
	* CANAL DE ENTRADA DE LA IMAGEN DE REFERENCIA.
	* El usuario copia cualquier imagen dentro de ./entradas y se adjunta
	* sola a la siguiente peticion de VFX, sin escribir ninguna ruta.
	*/
	const CARPETA_IMAGENES = path.join(process.cwd(), "entradas");

	const CARPETA_IMAGENES_USADAS = path.join(CARPETA_IMAGENES, "usadas");

	const EXTENSIONES_IMAGEN = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

	try {
		mkdirSync(CARPETA_IMAGENES, {
			recursive: true
		});
		mkdirSync(CARPETA_IMAGENES_USADAS, {
			recursive: true
		});
	} catch {
		console.warn(
			"[RobloxAI] No se pudo crear ./entradas; el canal de imagen de referencia no estará disponible."
		);
	}

	function listarImagenesEntrada() {
		try {
			const archivos = readdirSync(CARPETA_IMAGENES, { withFileTypes: true });
			return archivos
				.filter((entrada) => entrada.isFile())
				.map((entrada) => {
					const ruta = path.join(CARPETA_IMAGENES, entrada.name);
					const estadisticas = statSync(ruta);
					return {
						ruta,
						nombre: entrada.name,
						extension: path.extname(entrada.name).toLowerCase(),
						modificado: estadisticas.mtimeMs
					};
				})
				.filter((archivo) => EXTENSIONES_IMAGEN.includes(archivo.extension))
				.sort((a, b) => b.modificado - a.modificado);
		} catch (error) {
			logError("RobloxAI", "reference.folder_list_failed", error, {
				directory: path.basename(CARPETA_IMAGENES)
			});
			return [];
		}
	}

	function hayImagenPendiente() {
		return listarImagenesEntrada().length > 0;
	}

	function consumirImagenPendiente() {
		const pendientes = listarImagenesEntrada();
		if (pendientes.length === 0) return null;
		const archivo = pendientes[0];
		try {
			mkdirSync(CARPETA_IMAGENES_USADAS, { recursive: true });
			const destino = path.join(CARPETA_IMAGENES_USADAS, archivo.nombre);
			renameSync(archivo.ruta, destino);
			return destino;
		} catch (error) {
			logError("RobloxAI", "reference.move_to_used_failed", error, {
				fileName: archivo.nombre
			});
			return archivo.ruta;
		}
	}

	/*
	* Convierte el mensaje del usuario en el contenido que se envía
	* al modelo. Si incluye "imagen: ruta" o "@img: ruta|URL",
	* se añade como parte visual la imagen de referencia.
	*/
	function extraerImagenDelMensaje(mensaje) {
			const texto = String(mensaje || "");
			const encontrado =
			/(?:^|\s)(?:imagen|foto|captura|@img|image)\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([^\s,;]+))/i.exec(texto);

	if (!encontrado) {
		return null;
		}

		const ruta = String(encontrado[1] || encontrado[2] || encontrado[3] || "")
		.trim()
		.replace(/^["']/, "")
			.replace(/["']$/, "");

				if (!ruta) {
					return null;
					}

					if (/^https?:\/\/\S+$/i.test(ruta)) {
						return ruta;
						}

						try {
							if (!existsSync(ruta)) {
								console.warn(
									`[RobloxAI] Imagen de referencia no encontrada: ${ruta}`
								);
								return null;
							}

							const datos = readFileSync(ruta);

							if (
								!datos ||
								datos.length === 0 ||
								datos.length > 8 * 1024 * 1024
								) {
									return null;
								}

								const extension =
								path.extname(ruta).toLowerCase();
								const mime =
								extension === ".png"
								? "image/png"
								: extension === ".gif"
								? "image/gif"
								: extension === ".webp"
								? "image/webp"
								: "image/jpeg";

								return `data:${mime};base64,${datos.toString("base64")}`;
						} catch (error) {
							console.warn(
								`[RobloxAI] No se pudo leer la imagen de referencia: ${
								error instanceof Error
								? error.message
								: String(error)
								}`
							);
							return null;
						}
						}

						function contenidoConImagen(mensajeUsuario, contenido) {
		const imagen = extraerImagenDelMensaje(mensajeUsuario);

		if (!imagen) {
			// Evita reutilizar una imagen anterior en una petición sin referencia.
			referenciaVisualActual = null;
			return contenido;
		}

			console.log(
							"[RobloxAI] Imagen de referencia incluida en la petición."
						);

						referenciaVisualActual = imagen;

						return [
			{
				type: "text",
				text: contenido
			},
			{
				type: "image_url",
				image_url: {
					url: imagen
				}
			}
			];
			}

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
			*
			* Cada objeto se describe por COMO SE VE
			* (tamano, color, textura, emisores y sus
			* propiedades reales), no por su nombre.
			* Asi se puede reutilizar lo que ya existe
			* comparando apariencia, no etiquetas.
			*/
			const relevantObjects =
			objects
			.slice(0, 300)
			.map((object) => {
				const estructura =
				typeof object.estructura === "string" ? object.estructura.trim() : "";
				const cabecera = `- ${object.className}: ${object.path}/${object.name}`;
				return estructura ? `${cabecera} | ${estructura}` : cabecera;
			})
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
			"- Cada objeto real puede traer una descripcion de su APARIENCIA (tamano, color, textura, emisores y sus propiedades): usala para decidir si un efecto existente ya se parece al que pides, sin fiarte de su nombre.",
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
											} catch (error) {
												logError("RobloxAI", "action.envelope_parse_failed", error, { jsonLength: json.length });
												return null;
											}
											}

										/*
										* ============================================================
										* NORMALIZACIÓN DE ACCIONES
										* ============================================================
										*/

																function normalizarPropiedadesVFX(rawAction, className, mensajeUsuario = "") {
							const aliases = {
								size:"Size", position:"Position", orientation:"Orientation", cframe:"CFrame", anchor:"Anchored", anchored:"Anchored",
								cancollide:"CanCollide", can_collide:"CanCollide", cantouch:"CanTouch", canquery:"CanQuery", material:"Material",
								color:"Color", color3:"Color3", transparency:"Transparency", texture:"Texture", face:"Face", rate:"Rate",
								speed:"Speed", lifetime:"Lifetime", lightemission:"LightEmission", lightinfluence:"LightInfluence",
								emissiondirection:"EmissionDirection", acceleration:"Acceleration", rotation:"Rotation", brightness:"Brightness",
								range:"Range", enabled:"Enabled", shape:"Shape", width0:"Width0", width1:"Width1", curvesize0:"CurveSize0",
								curvesize1:"CurveSize1", attachment0:"Attachment0", attachment1:"Attachment1", castshadow:"CastShadow",
								reflectance:"Reflectance", massless:"Massless", maxdistance:"MaxDistance", zoffset:"ZOffset",
								visible:"Visible", alwaysontop:"AlwaysOnTop", image:"Image", imagetransparency:"ImageTransparency",
								imagecolor3:"ImageColor3", text:"Text", textcolor3:"TextColor3", texttransparency:"TextTransparency",
								textsize:"TextSize", backgroundtransparency:"BackgroundTransparency", bordersizepixel:"BorderSizePixel"
							};
							const source = {};
							if (rawAction.properties && typeof rawAction.properties === "object" && !Array.isArray(rawAction.properties)) {
								for (const [key, value] of Object.entries(rawAction.properties)) {
									const canonical = aliases[key.toLowerCase()];
									if (canonical) source[canonical] = value;
								}
							}
							for (const [key, value] of Object.entries(rawAction || {})) {
								const canonical = aliases[key.toLowerCase()];
								if (canonical && !(canonical in source)) source[canonical] = value;
							}
							const particle = className === "ParticleEmitter";
							const toVector3 = (value) => {
								if (Array.isArray(value) && value.length >= 3 && value.slice(0,3).every((n) => Number.isFinite(Number(n)))) return { type:"Vector3", x:Number(value[0]), y:Number(value[1]), z:Number(value[2]) };
								if (value && typeof value === "object" && !value.type && ["x","y","z"].every((k) => Number.isFinite(Number(value[k])))) return { type:"Vector3", x:Number(value.x), y:Number(value.y), z:Number(value.z) };
								return value;
							};
							const toEnum = (value, enumName) => {
								if (typeof value !== "string") return value;
								const parts = value.trim().split(".");
								if (parts[0] === "Enum" && parts.length === 3) return { type:"Enum", enum:parts[1] === "EmissionDirection" ? "NormalId" : parts[1], value:parts[2] };
								if (enumName && /^[A-Za-z][A-Za-z0-9_]*$/.test(value.trim())) return { type:"Enum", enum:enumName, value:value.trim() };
								return value;
							};
							const output = {};
							for (const [rawKey, rawValue] of Object.entries(source)) {
								const key = aliases[rawKey.toLowerCase()] || rawKey;
								let value = rawValue;
								if (["Size","Position","Orientation","Acceleration"].includes(key)) {
									if (particle && key === "Size" && Array.isArray(value) && value.length >= 2 && value.every((n) => Number.isFinite(Number(n)))) {
										value = { type:"NumberSequence", keypoints:[{time:0,value:Math.max(0,Number(value[0]))},{time:1,value:Math.max(0,Number(value[value.length-1]))}] };
									} else if (!particle || key !== "Size") value = toVector3(value);
								} else if (["Color","Color3","ImageColor3","TextColor3"].includes(key) && Array.isArray(value) && value.length >= 3 && value.every((n) => Number.isFinite(Number(n)))) {
									let rgb = value.slice(0,3).map(Number);
									if (rgb.some((n) => n > 1)) rgb = rgb.map((n) => Math.max(0,Math.min(255,n))/255);
									value = { type:"Color3", r:rgb[0], g:rgb[1], b:rgb[2] };
								} else if (["Material","Face","EmissionDirection","Shape"].includes(key)) {
									value = toEnum(value, key === "Material" ? "Material" : key === "Shape" ? "PartType" : "NormalId");
									if (typeof value === "string") continue;
								} else if (key === "Transparency" && typeof value === "number") {
									if (value < 0 || value > 1) continue;
									if (particle) value = { type:"NumberSequence", keypoints:[{time:0,value},{time:1,value}] };
								} else if (particle && key === "Size" && typeof value === "number") {
									value = { type:"NumberSequence", keypoints:[{time:0,value:Math.max(0,value)},{time:1,value:Math.max(0,value)}] };
								} else if (particle && ["Speed","Lifetime","Rotation"].includes(key) && typeof value === "number") {
									value = { type:"NumberRange", min:value, max:value };
								} else if (key === "Color" && particle && value && typeof value === "object" && value.type === "Color3") {
									value = { type:"ColorSequence", keypoints:[{time:0,color:{r:value.r,g:value.g,b:value.b}},{time:1,color:{r:value.r,g:value.g,b:value.b}}] };
								} else if (key === "Color" && typeof value === "string" && !/^[#]?[0-9a-f]{6}$/i.test(value.trim())) {
									continue;
								} else if (["Texture","Image"].includes(key) && (typeof value !== "string" || !value.trim())) {
									continue;
								}
								if (value !== undefined && value !== null) output[key] = value;
							}
							const request = String(mensajeUsuario || "").toLowerCase();
							if (["Part","MeshPart","WedgePart","CornerWedgePart"].includes(className)) {
								if (!("Anchored" in output) && /anchored|anclad[ao]/i.test(request)) output.Anchored = true;
								if (!("CanCollide" in output) && /sin colision|sin colisiones|no colision|no colisiones/i.test(request)) output.CanCollide = false;
								if (!("Material" in output) && /neon/i.test(request)) output.Material = { type:"Enum", enum:"Material", value:"Neon" };
								if (!("Color" in output) && !("Color3" in output)) {
									let rgb = null;
									if (/azul|blue|cyan|cian/i.test(request)) rgb = {r:0.05,g:0.55,b:1};
									else if (/rojo|red/i.test(request)) rgb = {r:1,g:0.08,b:0.08};
									else if (/verde|green/i.test(request)) rgb = {r:0.08,g:1,b:0.2};
									else if (/morado|violeta|purple|violet/i.test(request)) rgb = {r:0.55,g:0.1,b:1};
									else if (/amarillo|dorado|yellow|gold/i.test(request)) rgb = {r:1,g:0.75,b:0.05};
									else if (/naranja|orange/i.test(request)) rgb = {r:1,g:0.35,b:0.05};
									if (rgb) output.Color = { type:"Color3", ...rgb };
								}
							}
							return output;
						}

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

											// Compatibilidad con respuestas que envuelven cada acción por su nombre:
											// {"create_instance": {...}} en lugar de {"type":"create_instance", ...}.
							const hasActionType = ["type", "operation", "action", "actionType", "action_type", "command"]
								.some((field) => typeof rawAction[field] === "string" && rawAction[field].trim() !== "");
							if (!hasActionType) {
								const envelopeKeys = Object.keys(rawAction);
								if (envelopeKeys.length === 1) {
									const envelopeKey = envelopeKeys[0].trim().toLowerCase();
									const envelopePayload = rawAction[envelopeKeys[0]];
									const knownEnvelopeType = STANDARD_ACTIONS.has(envelopeKey)
										|| EXTENDED_ACTIONS.has(envelopeKey)
										|| ["buscar_texturas", "insertar_modelo", "verify_textures", "verify_models"].includes(envelopeKey);
									if (knownEnvelopeType && envelopePayload && typeof envelopePayload === "object" && !Array.isArray(envelopePayload)) {
										rawAction = { ...envelopePayload, type: envelopeKey };
									}
								}
							}
												// Algunos modelos omiten "type" o colocan la operación en "name".
							const typeFields = ["type", "operation", "action", "actionType", "action_type", "command"];
							const initialType = typeFields.map((field) => String(rawAction[field] || "").trim().toLowerCase()).find(Boolean) || "";
							const initialName = String(rawAction.name || rawAction.nombre || "").trim();
							const initialClass = String(rawAction.className || rawAction.class || rawAction.ClassName || "").trim();
							const visualClassNames = new Set(["Folder", "Model", "Part", "MeshPart", "WedgePart", "CornerWedgePart", "Attachment", "ParticleEmitter", "Beam", "Trail", "PointLight", "SpotLight", "SurfaceLight", "Highlight", "Texture", "Decal", "SpecialMesh", "BlockMesh", "CylinderMesh", "Fire", "Smoke", "Sparkles", "BillboardGui", "SurfaceGui", "Frame", "ImageLabel", "ImageButton", "TextLabel", "UIGradient", "UICorner"]);
							if (!initialType && EXTENDED_ACTIONS.has(initialName.toLowerCase())) {
								rawAction = { ...rawAction, type: initialName.toLowerCase() };
							} else if (!initialType && visualClassNames.has(initialClass) && (Object.prototype.hasOwnProperty.call(rawAction, "parent") || (rawAction.properties && typeof rawAction.properties === "object"))) {
								rawAction = { ...rawAction, type: "create_instance" };
							}

						const repairMode =
											options.repairMode === true;

											const soloAnalisis =
											options.soloAnalisis === true;

											/*
											* Detectar acciones extendidas empaquetadas.
											*/
											const packed = parsearAccionExtendidaEmpaquetada(rawAction);

											if (packed) {
																													if (
													repairMode &&
													(
														packed.type === "create_instance" ||
														packed.type === "create_script" ||
														packed.type === "create_local_script" ||
														packed.type === "create_module_script"
													)
												) {
													console.warn(
														"🛑 Creación nueva bloqueada durante reparación:",
														JSON.stringify(packed, null, 2)
													);
													return null;
												}

												// Decode the packed VFX operation before normalizing it.
												// Models may serialize paths as Workspace.Parent.Child;
												// the bridge uses Workspace/Parent/Child.
												const normalizePackedPath = (value) => {
													let route = String(value || "").trim().split(String.fromCharCode(92)).join("/");
													const root = BASES.find((base) => route.startsWith(base + "."));
													if (root) {
														route = root + "/" + route.slice(root.length + 1).split(".").join("/");
														}
														return route;
												};

												rawAction = { ...packed };
												// Compatibilidad con distintos formatos de acciones emitidos por rutas OpenAI.
												// "parent" representa el contenedor en create_instance; "target" suele ser la ruta completa del objeto en set_property(s).
												if (typeof rawAction.path !== "string" && typeof rawAction.parent === "string") {
													rawAction.path = rawAction.parent;
												}
												if (typeof rawAction.path !== "string" && typeof rawAction.target === "string") {
													rawAction.path = rawAction.target;
												}
												if (typeof rawAction.path === "string") {
													rawAction.path = normalizePackedPath(rawAction.path);
												}
												if (typeof rawAction.targetPath === "string") {
												rawAction.targetPath = normalizePackedPath(rawAction.targetPath);
											}
											// Vision/review routes sometimes encode set_property as { path: full.object.path, name: "Color", value: ... }.
											// Normalize that alias only for a known visual property and an explicit full object route.
											const packedActionType = String(rawAction.type || "").trim().toLowerCase();
											const packedPropertyAliases = new Set([
												"Enabled", "Anchored", "CanCollide", "CanTouch", "CanQuery",
												"Transparency", "Reflectance", "CastShadow", "Massless", "Locked",
												"Size", "Position", "Orientation", "CFrame", "Color", "Color3",
												"Material", "Shape", "Texture", "Face", "Rate", "Speed", "Lifetime",
												"EmissionDirection", "SpreadAngle", "LightEmission", "LightInfluence",
												"Brightness", "Range", "Shadows", "Width0", "Width1", "CurveSize0",
												"CurveSize1", "Attachment0", "Attachment1", "LockedToPart",
												"RotSpeed", "Rotation", "ZOffset", "MaxDistance"
											]);
											const propertyAlias = String(rawAction.name || "").trim();
											const targetParts = String(rawAction.path || "").split("/").filter(Boolean);
											if (
												packedActionType === "set_property" &&
												!String(rawAction.property || "").trim() &&
												packedPropertyAliases.has(propertyAlias) &&
												targetParts.length >= 3 &&
												BASES.includes(targetParts[0])
											) {
												rawAction.property = propertyAlias;
												rawAction.name = targetParts[targetParts.length - 1];
												rawAction.path = targetParts.slice(0, -1).join("/");
											}
														return normalizarAccion(rawAction, options);
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

																					// Admite rutas completas y el campo "parent" separado usado por algunos modelos.
								if (type === "create_instance") {
									const normalizeRoute = (value) => {
									let route = String(value || "").trim().replaceAll("\\", "/");
									const root = BASES.find((base) => route.startsWith(base + "."));
									if (root) route = root + "/" + route.slice(root.length + 1).split(".").join("/");
									return route;
								};
								const fullPath = normalizeRoute(path || rawAction.target || "");
								const tailName = fullPath.split("/").filter(Boolean).at(-1) || "";
								const actionLikeName = EXTENDED_ACTIONS.has(name.toLowerCase()) || ["create","instance"].includes(name.toLowerCase());
								if (typeof rawAction.parent === "string" && rutaValida(normalizeRoute(rawAction.parent))) {
									path = normalizeRoute(rawAction.parent);
									if (!name || actionLikeName) name = String(rawAction.targetName || tailName).trim();
								} else if (fullPath && (actionLikeName || fullPath.endsWith("/" + name) || (rawAction.parent === null && tailName === name))) {
									const separated = separarTarget(fullPath);
									if (separated.path && separated.name && rutaValida(separated.path)) {
										path = separated.path;
										if (actionLikeName || !name) name = separated.name;
									}
								} else if (fullPath) {
									path = fullPath;
								}
								}
/*
													* ACCIÓN ESPECIAL: búsqueda de texturas en el catálogo
													* público de Roblox. La resuelve el bridge, nunca el plugin.
													*/
													if (type === "set_property" && rawAction.properties && typeof rawAction.properties === "object" && !Array.isArray(rawAction.properties) && !String(rawAction.property || "").trim()) {
									type = "set_properties";
								}
								if (type === "buscar_texturas") {
														const keyword = String(
															rawAction.keyword ||
															rawAction.query ||
															rawAction.search ||
															rawAction.terms ||
															rawAction.text ||
															""
														).trim().slice(0, 80);

														if (!keyword) {
															return null;
															}

															return {
															type: "buscar_texturas",
															keyword,
															/*
															* tipo: "textura" (por defecto) busca imágenes/decals.
															* tipo: "modelo" busca efectos/modelos completos en el
															* catálogo: el bridge los inserta sin validar texturas.
															*/
															tipo: ["modelo", "model", "models", "efecto", "effect", "fx"]
															.includes(
																String(
																	rawAction.tipo ||
																	rawAction.kind ||
																	""
																)
																.trim()
																.toLowerCase()
															)
															? "modelo"
															: "textura",
																motivo: String(
																	rawAction.motivo ||
																	rawAction.reason ||
																	rawAction.why ||
																	""
																).trim().slice(0, 200),
																cantidad: 10
															};
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

																	if (EXTENDED_ACTIONS.has(type)) {
								if (type === "create_instance") {
									if (!className || repairMode) return null;
									return {
										type,
										className,
										path,
										name,
										properties: normalizarPropiedadesVFX(rawAction, className, options.mensajeUsuario)
									};
								}

								if (type === "set_property") {
									const property = String(rawAction.property || rawAction.propertyName || rawAction.property_name || "").trim();
									if (!property || ["Parent", "ClassName", "Source", "Archivable"].includes(property)) return null;
									if (repairMode && !existeObjetoReal(path, name, className)) return null;
									return { type, className, path, name, property, value: rawAction.value };
								}

								if (type === "set_properties") {
									if (!rawAction.properties || typeof rawAction.properties !== "object" || Array.isArray(rawAction.properties)) return null;
									if (repairMode && !existeObjetoReal(path, name, className)) return null;
									return {
										type,
										className,
										path,
										name,
										properties: normalizarPropiedadesVFX(rawAction, className, options.mensajeUsuario)
									};
								}
							}
							if (
																					type ===
																					"rename_instance"
																					) {
																						const newName =
																						String(
																							rawAction.newName || rawAction.new_name || rawAction.newname || rawAction.targetName || ""
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
													if (!action || typeof action !== "object") return false;

													// Accept native VFX actions and the packed envelope, then validate
													// the actual operation in either representation.
													let payload = action;
													const marker = "__ROBLOX_AI_EXTENDED_ACTION__";
													if (action.type === "update_script" && typeof action.code === "string") {
														if (!action.code.startsWith(marker)) return false;
														try {
															payload = JSON.parse(action.code.slice(marker.length).trim());
														} catch (error) {
															logError("RobloxAI", "action.validation_json_failed", error, { codeLength: action.code.length });
															return false;
														}
														}

														if (!payload || typeof payload !== "object") return false;

															/*
															* La búsqueda de texturas la resuelve el bridge antes de
															* llegar a Studio: no tiene path ni className.
															*/
														if (String(payload.type || "") === "buscar_texturas") {
															return true;
														}

														/*
														* La inserción de modelos del catálogo la decide el bridge
														* (nunca el modelo): solo se acepta con un assetId numérico.
														*/
														if (String(payload.type || "") === "insertar_modelo") {
															const id = String(payload.assetId || payload.id || "").trim();
															return /^\d+$/.test(id);
														}


															const actionType = String(payload.type || "");
															const className = String(payload.className || "");
															const path = String(payload.path || "").replaceAll("\\", "/");
															const root = path.split("/")[0];
															const visualRoots = new Set(["Workspace", "ReplicatedStorage", "Lighting", "StarterGui"]);
															if (!visualRoots.has(root)) return false;

																const visualClasses = new Set([
																	"Folder", "Model", "Part", "MeshPart", "WedgePart", "CornerWedgePart",
																	"Attachment", "ParticleEmitter", "Beam", "Trail", "PointLight", "SpotLight",
																	"SurfaceLight", "Highlight", "Texture", "Decal", "SpecialMesh", "BlockMesh",
																	"CylinderMesh", "Fire", "Smoke", "Sparkles", "BillboardGui", "SurfaceGui",
																	"Frame", "ImageLabel", "ImageButton", "UIGradient", "UICorner"
																	]);
																const allowedMutationsWithoutClass = new Set(["set_property", "set_properties", "rename_instance", "move_instance"]);
						if (!visualClasses.has(className)) {
							if (className !== "" || !allowedMutationsWithoutClass.has(actionType)) return false;
							if (actionType === "set_property" || actionType === "set_properties") {
								const safeProperties = new Set([
									"Enabled", "Anchored", "CanCollide", "CanTouch", "CanQuery",
									"Transparency", "Reflectance", "CastShadow", "Massless", "Locked",
									"Size", "Position", "Orientation", "CFrame", "Color", "Color3",
									"Material", "Shape", "Texture", "Face", "Rate", "Speed", "Lifetime",
									"EmissionDirection", "SpreadAngle", "LightEmission", "LightInfluence",
									"Brightness", "Range", "Shadows", "Width0", "Width1", "CurveSize0",
									"CurveSize1", "Attachment0", "Attachment1", "LockedToPart",
									"RotSpeed", "Rotation", "ZOffset", "MaxDistance"
								]);
								const mutationKeys = actionType === "set_property"
									? [String(payload.property || "")]
									: Object.keys(payload.properties && typeof payload.properties === "object" ? payload.properties : {});
								if (mutationKeys.length === 0 || mutationKeys.some((key) => !safeProperties.has(key))) return false;
							} else if (actionType === "rename_instance") {
								const newName = String(payload.newName || payload.new_name || payload.newname || "").trim();
								if (!String(payload.name || "").trim() || !newName || /[\\/]/.test(newName) || newName === "." || newName === "..") return false;
							} else if (actionType === "move_instance") {
								const targetPath = String(payload.targetPath || payload.target_path || payload.destination || payload.destinationPath || "").replaceAll("\\", "/");
								if (!String(payload.name || "").trim() || !visualRoots.has(targetPath.split("/")[0])) return false;
							}
						}

											const allowed = new Set([
																		"create_instance", "set_property", "set_properties", "rename_instance", "move_instance"
																		]);
																	if (allowed.has(actionType)) {
																		if (actionType === "move_instance") {
																			const targetPath = String(payload.targetPath || "").replaceAll("\\", "/");
																			if (!visualRoots.has(targetPath.split("/")[0])) return false;
																		}
																		return true;
																		}

																		const explicitlyRequestsDeletion =
																		/elimina|eliminar|borra|borrar|quita|quitar|remove|delete/i.test(String(mensajeUsuario));
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
														console.warn(
															"⚠️ Acción rechazada por la política VFX; detalle:",
															JSON.stringify({
																type: action.type,
																className: action.className || "",
																path: action.path || "",
																name: action.name || "",
																property: action.property || "",
																properties: action.properties ? Object.keys(action.properties) : [],
																targetPath: action.targetPath || ""
																}, null, 2)
														);
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
: action.type === "buscar_texturas"
? `${action.type}|${action.tipo || "textura"}|${action.keyword}`
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

				async function preguntarNvidiaVision(messages, model = NVIDIA_VISION_MODEL) {
					const apiKey = String(process.env.NVIDIA_API_KEY || "").trim();
					if (!apiKey) throw new Error("No hay NVIDIA_API_KEY configurada.");
						const primaryNemotronTimeoutMs = Math.max(
							10000,
							Number(process.env.NVIDIA_VISION_PRIMARY_TIMEOUT_MS || 25000)
						);
						const timeoutMs =
						model === NVIDIA_VISION_MODEL && /nemotron-3-nano-omni/i.test(model)
						? Math.min(NVIDIA_VISION_TIMEOUT_MS, primaryNemotronTimeoutMs)
						: NVIDIA_VISION_TIMEOUT_MS;
						const controller = new AbortController();
						const timer = setTimeout(() => controller.abort(), timeoutMs);
						try {
							const body = {
								model,
								messages,
								temperature: 0.1,
								max_tokens: Number(process.env.NVIDIA_VISION_MAX_TOKENS || 2400),
								stream: false
							};
							// This model-specific option is only sent to Nemotron Omni.
							if (/nemotron-3-nano-omni/i.test(model)) {
								body.chat_template_kwargs = { enable_thinking: false };
								}

								const response = await fetch(NVIDIA_VISION_URL, {
									method: "POST",
									headers: {
										Authorization: `Bearer ${apiKey}`,
										"Content-Type": "application/json",
										Accept: "application/json"
									},
									body: JSON.stringify(body),
									signal: controller.signal
								});
								const raw = await response.text();
								let data;
								try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
								if (!response.ok) {
									const detail = String(
										data?.detail || data?.message || data?.error?.message || raw || "sin detalles"
									).slice(0, 900);
									throw new Error(`NVIDIA Vision HTTP ${response.status}: ${detail}`);
									}
									const content = data?.choices?.[0]?.message?.content;
									if (typeof content === "string" && content.trim()) return content;
										if (Array.isArray(content)) {
											const textContent = content
											.filter((part) => typeof part?.text === "string")
											.map((part) => part.text)
											.join("\n")
											.trim();
											if (textContent) return textContent;
												}
											const firstChoice = data?.choices?.[0];
											const message = firstChoice?.message;
											const responseShape = {
												finish_reason: firstChoice?.finish_reason ?? null,
												message_fields: message && typeof message === "object" ? Object.keys(message) : [],
												has_reasoning: Boolean(message?.reasoning || message?.reasoning_content)
											};
											console.error("[RobloxAI] NVIDIA Vision no devolvió respuesta final:", JSON.stringify(responseShape));
											throw new Error(
												"NVIDIA Vision respondió sin texto final. Detalle seguro: " + JSON.stringify(responseShape)
											);
						} catch (error) {
							if (controller.signal.aborted) {
								const timeoutError = new Error(`NVIDIA Vision agotó el tiempo límite de ${timeoutMs} ms para ${model}.`);
								logError("RobloxAI", "vision.request_timeout", timeoutError, { model, timeoutMs });
								throw timeoutError;
							}
							logError("RobloxAI", "vision.request_failed", error, { model, timeoutMs });
							throw error;
						} finally {
							clearTimeout(timer);
						}
						}

					async function preguntarNvidiaVisionConReintento(messages, model = NVIDIA_VISION_MODEL) {
						try {
							return await preguntarNvidiaVision(messages, model);
						} catch (firstError) {
							const firstMessage = String(firstError?.message || firstError);
							const capacityError = /ResourceExhausted|Worker local total request limit reached|all workers are busy/i.test(firstMessage);
							if (!capacityError) throw firstError;

							const retryDelayMs = 2500;
							console.warn(
								`[RobloxAI] El proveedor visual alcanzó su límite de capacidad (${model}); se hará un único reintento en ${retryDelayMs} ms.`
							);
							await new Promise((resolve) => setTimeout(resolve, retryDelayMs));

							try {
								return await preguntarNvidiaVision(messages, model);
							} catch (retryError) {
								console.error(
									"[RobloxAI] El reintento del proveedor visual también falló.",
									retryError instanceof Error ? retryError : new Error(String(retryError))
								);
								throw retryError;
							}
						}
					}

					async function analizarReferenciaVisual(messages) {
						if (visualAnalysisCache.has(messages)) {
							return visualAnalysisCache.get(messages);
						}

						const imagePart = messages
						.filter((message) => message?.role === "user" && Array.isArray(message.content))
						.flatMap((message) => message.content)
						.find((part) => part?.type === "image_url" && typeof part.image_url?.url === "string");

						if (!imagePart) {
							throw new Error("No encontré una imagen válida para analizar.");
							}

							const analysisPromise = (async () => {
								console.log("[RobloxAI] Analizando la referencia visual de forma compacta...");
								const visualMessages = [
								{
									role: "system",
									content: [
									"Eres un artista técnico senior de VFX para Roblox.",
									"Convierte esta imagen en una ESPECIFICACIÓN MEDIBLE que otro sistema usará para construir geometría real en Roblox Studio.",
									"Empieza con 2 o 3 frases en prosa describiendo lo que se ve. Después rellena TODAS las etiquetas de abajo, cada una en su propia linea, con valores concretos observados en la imagen y sin adornos:",
									"ESTRUCTURA: inventario numerado de cada figura distinguible (por ejemplo 1 = anillo exterior, 2 = anillo medio, 3 = nucleo, 4 = destellos alrededor), indicando si cada una es hueca (anillo) o maciza (disco).",
									"CANTIDAD: numero total de figuras y cuantas de ellas son capas concentricas o paralelas.",
									"TAMANO_RELATIVO: diametro de cada figura en porcentaje respecto a la mayor, que vale 100.",
									"SEPARACION: distancia entre figuras consecutivas, en porcentaje del diametro de la mayor.",
									"ESPESOR: grosor del contorno de cada figura en porcentaje de su propio diametro.",
									"ALTURA_RELATIVO: altura de cada figura sobre la superficie de apoyo, en porcentaje del diametro mayor (0 = apoyada en el suelo).",
									"PLANO: suelo, vertical o libre, y desde donde lo deduces.",
									"ESCENA: si la figura flota sola o esta posada sobre una superficie concreta.",
									"PALETA: #RRGGBB dominante, #RRGGBB acento, #RRGGBB nucleo",
									"BRILLO: si el nucleo es cegador, medio o mate, y si hay halo o resplandor alrededor.",
									"MATERIAL_APARENTE: energia, humo, liquido, metal, cristal o luz.",
									"PARTICULAS: que particulas se ven, en que zona estan y hacia donde se mueven.",
									"RASGOS_DISTINTIVOS: los 3 detalles que hay que reproducir si o si para que se reconozca la imagen.",
									"No generes JSON de acciones, scripts, ni nombres de objetos de Roblox.",
									"No inventes detalles ocultos ni describas animación como observada si es una imagen estática.",
									"No lo resumes en pocas palabras: la especificación larga y completa es más util que un resumen corto."
									].join("\n")
								},
								{
									role: "user",
									content: [
									{
										type: "text",
										text: "Analiza esta referencia para replicar su estilo visual en un VFX editable de Roblox Studio. Describe los rasgos visuales útiles y termina con el bloque FORMA / PLANO / PALETA / GEOMETRÍA / PARTICULAS, porque decide orientación, forma, posición y capas según la imagen. No presupongas que el efecto está en el suelo ni que flota si la referencia no lo indica."
									},
									imagePart
									]
								}
								];

								let analysis;
								try {
									analysis = await preguntarNvidiaVisionConReintento(visualMessages, NVIDIA_VISION_MODEL);
								} catch (primaryError) {
									const primaryMessage = String(primaryError?.message || primaryError);
									const isEndpointDegraded =
									/DEGRADED function cannot be invoked/i.test(primaryMessage) ||
										/NVIDIA Vision HTTP 5\d\d/i.test(primaryMessage) ||
										/Failed to generate completions/i.test(primaryMessage) ||
										/NVIDIA Vision agotó el tiempo límite/i.test(primaryMessage) ||
										/This operation was aborted/i.test(primaryMessage) ||
										/NVIDIA Vision respondió sin texto final/i.test(primaryMessage);
										if (!isEndpointDegraded || !NVIDIA_VISION_FALLBACK_MODEL || NVIDIA_VISION_FALLBACK_MODEL === NVIDIA_VISION_MODEL) {
											throw primaryError;
											}
											console.warn(
												`[RobloxAI] Modelo visual principal no disponible; probando alternativa ${NVIDIA_VISION_FALLBACK_MODEL}...`
											);
											try {
												analysis = await preguntarNvidiaVisionConReintento(visualMessages, NVIDIA_VISION_FALLBACK_MODEL);
											} catch (fallbackError) {
												throw new Error(
													`Fallaron ambos modelos visuales. Principal: ${primaryMessage}. Alternativa: ${String(fallbackError?.message || fallbackError)}`
												);
											}
								}

								const cleanAnalysis = String(analysis || "").trim();
								if (!cleanAnalysis) {
									throw new Error("El modelo visual no devolvió una descripción utilizable.");
									}
									console.log("[RobloxAI] Descripción visual recibida; ahora el modelo de texto diseñará las acciones.");
									return cleanAnalysis;
							})().catch((error) => {
								visualAnalysisCache.delete(messages);
								throw error;
							});

							visualAnalysisCache.set(messages, analysisPromise);
							return analysisPromise;
							}

						async function pedirRespuestaEjecutable(messages, extra = "") {
							const finalMessages = extra
							? [...messages, { role: "user", content: extra }]
							: messages;

							const contieneImagen = finalMessages.some((message) =>
								Array.isArray(message?.content) &&
								message.content.some((part) =>
									part?.type === "image_url" && typeof part.image_url?.url === "string"
								)
							);

							if (contieneImagen && process.env.NVIDIA_API_KEY?.trim()) {
	const analisisVisual = await analizarReferenciaVisual(messages);
	const mensajesPreparados = finalMessages.map((message) => {
		if (!Array.isArray(message?.content)) return message;
		const partesImagen = message.content.filter((part) => part?.type === "image_url" && typeof part.image_url?.url === "string");
		const texto = message.content
			.filter((part) => part?.type === "text")
			.map((part) => String(part.text || ""))
			.join("\n")
			.replace(/(?:^|\n)\s*@img:\s*(?:"[^"]+"|'[^']+'|[^\s]+)\s*/gi, "\n")
			.trim();
		if (partesImagen.length === 0) return message;
		const textoEnriquecido = [
			texto,
			"ANÁLISIS VISUAL DE LA IMAGEN (especificación observada):",
			analisisVisual,
			"Usa la imagen original y esta especificación. Prioriza la silueta y los rasgos distintivos de la referencia; no inventes objetos ni posiciones que la contradigan."
		].filter(Boolean).join("\n\n");
		if (OMNIROUTE_VISION_MODEL) {
			return {
				...message,
				content: [
					{ type: "text", text: textoEnriquecido },
					...partesImagen
				]
			};
		}
		return { ...message, content: textoEnriquecido };
	});

	if (OMNIROUTE_VISION_MODEL) {
		try {
			console.log("[RobloxAI] Constructor multimodal: enviando imagen original + análisis visual al modelo visual de OmniRoute.");
			return await preguntarOmniRoute(mensajesPreparados, {
				model: OMNIROUTE_VISION_MODEL,
				json: true,
				reasoningEffort: "none",
				reasoningFormat: "hidden",
				temperature: 0.1,
				timeoutMs: Number(process.env.OMNIROUTE_TIMEOUT_MS || 300000),
				attemptsPerKey: 2
			});
		} catch (error) {
			console.warn("[RobloxAI] El constructor multimodal falló; se intentará el modelo de texto con la especificación visual.", error instanceof Error ? error.message : String(error));
		}
	}

	const mensajesTextuales = mensajesPreparados.map((message) => {
		if (!Array.isArray(message?.content)) return message;
		const texto = message.content
			.filter((part) => part?.type === "text")
			.map((part) => String(part.text || ""))
			.join("\n");
		return { ...message, content: texto };
	});
	console.log("[RobloxAI] Enviando análisis visual estructurado al constructor de texto; no se configuró un constructor multimodal disponible.");
	return preguntarOmniRoute(mensajesTextuales, {
		json: true,
		reasoningEffort: "none",
		reasoningFormat: "hidden",
		temperature: 0.1,
		timeoutMs: Number(process.env.OMNIROUTE_TIMEOUT_MS || 300000),
		attemptsPerKey: 2
	});
}
	if (contieneImagen && !OMNIROUTE_VISION_MODEL) {
		throw new Error(
			"Hay una imagen adjunta, pero no se ha configurado un modelo visual válido. " +
			"Configura NVIDIA_API_KEY para usar la API visual directa de NVIDIA, o configura OMNIROUTE_VISION_MODEL " +
			"con el ID exacto de un modelo con entrada de imagen que aparezca en http://127.0.0.1:20128/v1/models. " +
			"No añadas el sufijo :free salvo que aparezca literalmente en ese catálogo."
		);
		}

		if (contieneImagen) {
			console.log(`🖼️ Imagen detectada. Usando modelo visual de OmniRoute: ${OMNIROUTE_VISION_MODEL}...`);
			}
			return preguntarOmniRoute(finalMessages, {
				...(contieneImagen ? { model: OMNIROUTE_VISION_MODEL } : {}),
				json: !contieneImagen,
				reasoningEffort: "none",
				reasoningFormat: "hidden",
				temperature: 0.1,
				timeoutMs: Number(process.env.OMNIROUTE_TIMEOUT_MS || 300000),
				attemptsPerKey: 2
			});
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
			seccionTexturas(mensajeUsuario),
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
				contenidoConImagen(mensajeUsuario, contenido)
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
								: "⚠️ La primera respuesta VFX no fue ejecutable. Solicitando JSON válido con acciones visuales compatibles..."
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

									console.info(
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

										// Las búsquedas de texturas se resuelven en el servidor: nunca las empujes al plugin.
										const modelosParaInsertar = [];
										if (!soloAnalisis) {
										const busquedas = (resultado.actions || []).filter(
											(accion) => accion && accion.type === "buscar_texturas"
										);

										// Los modelos que traigamos del catálogo los empuja el bridge,
										// nunca el modelo: así nadie puede inventar un assetId.

										if (busquedas.length > 0) {
											const respuestas = [];

											for (const busqueda of busquedas.slice(0, 2)) {
												// eslint-disable-next-line no-await-in-loop
												const tipo = String(busqueda.tipo || "textura");
												const resultados = await buscarTexturasVerificadas(
													String(busqueda.keyword || ""),
													tipo
												);

												respuestas.push(
													textoResultadoBusquedaTexturas(
														String(busqueda.keyword || ""),
														resultados,
														tipo
													)
												);

												/*
												* Los modelos del catálogo se insertan en Studio desde
												* el bridge, con un assetId que ya vino del catálogo.
												*/
												if (tipo === "modelo" && resultados && resultados.length > 0) {
													modelosParaInsertar.push(resultados[0]);
													}
												}

													texto = await pedirRespuestaEjecutable(
														messages,
														[
														"RESULTADO DE LA BÚSQUEDA DE TEXTURAS EN EL CATÁLOGO DE ROBLOX (ids comprobados en Studio con ContentProvider):",
														...respuestas,
														"",
														"Usa SOLO los ids listados arriba o los del CATÁLOGO DE TEXTURAS VERIFICADAS del contexto.",
														"No inventes ningún id de textura.",
														"No vuelvas a emitir acciones buscar_texturas.",
														"Si la búsqueda está vacía, continúa creando el efecto con geometría y objetos nativos de Roblox; no canceles el VFX ni dependas de otra búsqueda. No inventes asset IDs.",
														"Devuelve solamente JSON."
														].join("\n")
													);

													resultado = extraerResultado(
														texto,
														{
															repairMode:
															reparacion,
															soloAnalisis,
															mensajeUsuario
														}
													);

													if (!resultado) {
														return null;
														}
														}
												}

											resultado.actions = (resultado.actions || []).filter(
												(accion) => !accion || accion.type !== "buscar_texturas"
											);

											// Si Studio aún no recogió una verificación de texturas, no la pierdas:
											// un id sin verificar deja el efecto invisible.
											const verificacionesPendientes = pendingActions.filter(
												(accion) => accion && accion.type === "verify_textures"
											);

										pendingActions = [
										...verificacionesPendientes,
										...resultado.actions
										];

										if (modelosParaInsertar.length > 0) {
											console.log(
												`[RobloxAI] Insertando ${modelosParaInsertar.length} modelo(s) del catálogo de Roblox.`
											);

											pendingActions = [
											...pendingActions,
											...modelosParaInsertar.map(
												(modelo) => ({
												type: "insertar_modelo",
												assetId: String(modelo.id),
												nombre: String(modelo.nombre || `Catalogo_${modelo.id}`),
												path: "Workspace/VFXCatalogo"
												})
											)
											];
											}

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

											console.info(
												`✅ OmniRoute terminó: ${pendingActions.length} acción(es) listas para Roblox Studio.`
											);

											console.info(
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

					console.info(
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
	if (Date.now() - lastVisualCapture.receivedAt > 90000) {
		lastVisualCapture = null;
		return;
	}

	// Consumir cada captura una sola vez evita revisar acciones posteriores con píxeles viejos.
	const capture = lastVisualCapture;
	lastVisualCapture = null;
	visualReviewCycles += 1;

	const referencia = referenciaVisualActual;
	if (!referencia) {
		console.warn("[RobloxAI] No hay referencia original guardada; se omite la corrección visual.");
		return;
	}

	const esProyeccion = capture.tipo === "proyeccion";
	const instrucciones = [
		"Eres un revisor técnico de VFX para Roblox Studio.",
		"Recibes una representación sintética del efecto generado y la imagen de referencia original.",
		"PROCEDENCIA: " + String(capture.tipo || "desconocido") + ". " + String(capture.nota || ""),
		esProyeccion
			? "La imagen del efecto es una proyección geométrica aproximada, NO una captura renderizada de Studio. No puedes comprobar iluminación real, sombras, píxeles reales de Decal/Texture, forma exacta de MeshPart, transparencias complejas ni partículas simuladas."
			: "No asumas que la imagen representa un render real salvo que la procedencia lo confirme.",
		"Usa la proyección solo para valorar composición aproximada, proporciones, posiciones, colores, forma general de piezas y trazos aproximados de Beam/Trail.",
		"Usa el resumen estructural adjunto para interpretar Attachments, ParticleEmitters, Beam, Trail, luces, Decal/Texture y propiedades que no se rasterizan fielmente.",
		"No confundas un rectángulo tintado que representa una superficie texturada con la textura real.",
		"No inventes diferencias ni realices cambios basados en detalles invisibles en estos datos.",
		"Devuelve diferencias concretas solo si están respaldadas por la proyección o los metadatos; si no, indica que no hay evidencia suficiente y devuelve actions: []."
	].join("\n");

	const detalleEscena = String(capture.sceneSummary || "").slice(0, 7000);
	const comparacionMensajes = [
		{ role: "system", content: instrucciones },
		{
			role: "user",
			content: [
				{
					type: "text",
					text: [
						"Compara la primera imagen (proyección aproximada del resultado) con la segunda imagen (referencia original).",
						"Acciones recién reportadas por Studio: " + JSON.stringify({
							successful: report.successful,
							failed: report.failed,
							actions: (report.actions || []).slice(0, 35)
						}),
						"METADATOS DE LA ESCENA PROYECTADA (propiedades reales, no píxeles del render):",
						detalleEscena || "[No se recibió resumen estructural.]"
					].join("\n\n")
				},
				{ type: "image_url", image_url: { url: capture.dataUrl } },
				{ type: "image_url", image_url: { url: referencia } }
			]
		}
	];

	let comparacion = "";
	let errorVisionDirecta = null;
	const tieneClaveNvidia = Boolean(String(process.env.NVIDIA_API_KEY || "").trim());

	if (tieneClaveNvidia) {
		try {
			comparacion = await preguntarNvidiaVisionConReintento(comparacionMensajes);
		} catch (primaryError) {
			const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
			errorVisionDirecta = primaryMessage;

			if (NVIDIA_VISION_FALLBACK_MODEL && NVIDIA_VISION_FALLBACK_MODEL !== NVIDIA_VISION_MODEL) {
				try {
					console.warn(`[RobloxAI] La revisión visual directa falló; probando alternativa ${NVIDIA_VISION_FALLBACK_MODEL}...`);
					comparacion = await preguntarNvidiaVisionConReintento(comparacionMensajes, NVIDIA_VISION_FALLBACK_MODEL);
					errorVisionDirecta = null;
				} catch (fallbackError) {
					errorVisionDirecta = `Principal: ${primaryMessage}. Alternativa: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`;
				}
			}
		}
	}

	// NVIDIA es opcional. Si no hay clave o su endpoint falla, usa la ruta visual
	// configurada en OmniRoute en lugar de omitir siempre la revisión posterior.
	if (!String(comparacion || "").trim()) {
		const modeloRevision = OMNIROUTE_VISION_MODEL || OMNIROUTE_MODEL_ID;
		try {
			console.warn(`[RobloxAI] Revisando el resultado mediante OmniRoute (${modeloRevision})...`);
			comparacion = await preguntarOmniRoute(comparacionMensajes, {
				model: modeloRevision,
				temperature: 0.1,
				reasoningEffort: "none",
				timeoutMs: Math.min(
					120000,
					Math.max(10000, Number(process.env.OMNIROUTE_TIMEOUT_MS || 120000))
				),
				attemptsPerKey: 1
			});
		} catch (omniError) {
			console.warn(
				"[RobloxAI] Revisión visual omitida: fallaron las rutas visuales disponibles.",
				JSON.stringify({
					nvidia: errorVisionDirecta,
					omniRoute: omniError instanceof Error ? omniError.message : String(omniError)
				})
			);
			return;
		}
	}

	const diagnostico = [
		"DIAGNÓSTICO COMPARATIVO BASADO EN PROYECCIÓN SINTÉTICA (no es una captura real del viewport):",
		comparacion,
		"Corrige solo diferencias respaldadas por la evidencia. Si la proyección o los metadatos no permiten justificar un cambio, devuelve actions: []."
	].join("\n\n");

	try {
		const mensajesRevision = [
			{ role: "system", content: VFX_SYSTEM },
			{
				role: "user",
				content: [
					{ type: "text", text: [
						"REVISIÓN DESPUÉS DE UNA TANDA DE CAMBIOS.",
						"Resultado estructural: " + report.successful + " acciones correctas y " + report.failed + " fallidas.",
						"Resumen real de instancias y propiedades:",
						detalleEscena || "[sin resumen estructural]",
						diagnostico,
						"No borres objetos ni crees scripts/remotes. No declares verificado lo que solo sea una estimación."
					].join("\n\n") }
				]
			}
		];
		const opcionesRevision = {
			json: true,
			reasoningEffort: "none",
			reasoningFormat: "hidden",
			temperature: 0.1,
			timeoutMs: Math.min(Number(process.env.OMNIROUTE_TIMEOUT_MS || 120000), 120000),
			attemptsPerKey: 1
		};
		const pareceContenerJson = (respuesta) => {
			const textoRespuesta = String(respuesta || "");
			const inicioJson = textoRespuesta.indexOf("{");
			return inicioJson >= 0 && textoRespuesta.lastIndexOf("}") > inicioJson;
		};
		const convertirRespuestaRevision = (respuesta) => {
			if (!pareceContenerJson(respuesta)) return null;
			return extraerResultado(respuesta, {
				repairMode: false,
				soloAnalisis: false,
				mensajeUsuario: "Revisión aproximada de VFX; no borrar objetos."
			});
		};

		let texto = await preguntarOmniRoute(mensajesRevision, opcionesRevision);
		guardarRespuestaRevisionVisual("respuesta-inicial", texto, OMNIROUTE_VISION_MODEL || OMNIROUTE_MODEL_ID);
		let result = convertirRespuestaRevision(texto);

		// Algunos enrutamientos devuelven solo una etiqueta de seguridad, por ejemplo
		// "User Safety: safe", incluso cuando se solicitó JSON. Reintenta una vez sin
		// response_format y con el formato de salida reforzado; nunca conviertas esa
		// etiqueta en acciones ni marques como fallida la tanda original de Studio.
		if (!result) {
			console.warn("[RobloxAI] La revisión visual no devolvió JSON utilizable; se intentará una vez con formato explícito.");
			const mensajesReintento = mensajesRevision.map((mensaje) => ({
				...mensaje,
				content: Array.isArray(mensaje.content)
					? mensaje.content.map((parte) => ({ ...parte }))
					: mensaje.content
			}));
			const ultimaSolicitud = mensajesReintento[mensajesReintento.length - 1];
			const instruccionesFormato = [
				"FORMATO OBLIGATORIO DE ESTA RESPUESTA:",
				"Devuelve exclusivamente un objeto JSON válido, sin Markdown ni texto fuera del objeto.",
				"El objeto debe incluir la propiedad \"reply\" como texto y la propiedad \"actions\" como arreglo.",
				"Si no hay una corrección visual respaldada por la evidencia, devuelve exactamente: {\"reply\":\"No se justifican más cambios.\",\"actions\":[]}.",
				"No devuelvas etiquetas de estado o seguridad; responde con el objeto JSON solicitado."
			].join("\n");
			if (Array.isArray(ultimaSolicitud.content)) {
				ultimaSolicitud.content.push({ type: "text", text: instruccionesFormato });
			} else {
				ultimaSolicitud.content = [String(ultimaSolicitud.content || ""), instruccionesFormato].join("\n\n");
			}
			const textoReintento = await preguntarOmniRoute(mensajesReintento, {
				reasoningEffort: "none",
				temperature: 0.1,
				timeoutMs: Math.min(Number(process.env.OMNIROUTE_TIMEOUT_MS || 120000), 120000),
				attemptsPerKey: 1
			});
			guardarRespuestaRevisionVisual("respuesta-reintento", textoReintento, OMNIROUTE_VISION_MODEL || OMNIROUTE_MODEL_ID);
			result = convertirRespuestaRevision(textoReintento);
		}

		if (!result) {
			console.warn("[RobloxAI] Revisión visual omitida: OmniRoute no devolvió acciones JSON utilizables tras un reintento. La tanda principal de Studio se conserva; no se generaron ajustes visuales automáticos.");
			return;
		}
		// La revisión es solo correctiva: no debe borrar objetos ni iniciar búsquedas/inserciones.
		const tiposPermitidosEnRevision = new Set([
			"create_instance", "set_property", "set_properties", "rename_instance", "move_instance"
		]);
		result.actions = (result.actions || []).filter((accion) =>
			accion && tiposPermitidosEnRevision.has(String(accion.type || "").toLowerCase())
		);
		if (!result || result.actions.length === 0) {
			console.log("[RobloxAI] Revisión aproximada terminada: no se justificaron más cambios.");
			return;
		}
		pendingActions = result.actions;
		console.log(`[RobloxAI] Revisión aproximada ${visualReviewCycles}/${MAX_VISUAL_REVIEW_CYCLES}: ${pendingActions.length} ajuste(s) listos para Studio.`);
		console.info(result.reply || "Ajustes visuales preparados.");
	} catch (error) {
		console.warn("[RobloxAI] No se pudieron convertir las diferencias en acciones; no se generaron correcciones a ciegas.", error instanceof Error ? error.message : String(error));
	}
}


					app.post(
						"/visual-capture",
						(req, res) => {
							const data = req.body || {};
							const imageBase64 = String(data.imageBase64 || "");
							if (!imageBase64 || imageBase64.length > 6000000 || !/^[A-Za-z0-9+/=]+$/.test(imageBase64)) {
								logError("RobloxAI", "visual_capture.invalid_payload", new Error("La captura visual está vacía, supera 6 MB o no contiene Base64 válido."), {
									requestId: req.diagnosticId || null,
									base64Length: imageBase64.length,
									hasImage: Boolean(imageBase64)
								});
								return res.status(400).json({ ok: false, error: "Captura PNG vacía, demasiado grande o inválida.", requestId: req.diagnosticId || null });
							}
								lastVisualCapture = {
									dataUrl: `data:image/png;base64,${imageBase64}`,
									receivedAt: Date.now(),
									resolution: data.resolution || null,
									tipo: typeof data.tipo === "string" ? data.tipo : "desconocido",
									nota: typeof data.nota === "string" ? data.nota.slice(0, 700) : "",
									sceneSummary: typeof data.sceneSummary === "string" ? data.sceneSummary.slice(0, 18000) : ""
								};
								console.log(`[RobloxAI] Imagen de revision recibida desde Studio (tipo: ${lastVisualCapture.tipo}).`);
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
							const requiereRevisionVisual = actions.some((action) => {
								const tipo = String(action?.type || action?.action || "").toLowerCase();
								return tipo !== "verify_textures" && tipo !== "verify_models";
							});
							if (lastExecutionReport.successful > 0 && lastVisualCapture && requiereRevisionVisual) {
								void evaluarCapturaVFX(lastExecutionReport);
							} else if (!requiereRevisionVisual) {
								// Una validación de catálogo no es una escena construida:
								// jamás debe iniciar revisión usando una proyección vacía o antigua.
								lastVisualCapture = null;
							}
						}
					);

					app.post(
						"/texture-catalog",
						(req, res) => {
							const data = req.body || {};
							const texturas = Array.isArray(data.textures) ? data.textures.slice(0, 800) : [];

							catalogoTexturasProyecto = texturas
							.map((textura) => ({
								id: normalizarIdTextura(textura && textura.id),
								nombre: String((textura && (textura.nombre || textura.origen)) || ""),
								categoria: String((textura && textura.categoria) || "Proyecto")
							}))
							.filter((textura) => textura.id);

							cacheTexturas.project = catalogoTexturasProyecto;
							guardarCacheTexturas(cacheTexturas);

							console.log(
								`[RobloxAI] 📚 Catálogo de texturas recibido: ${catalogoTexturasProyecto.length} textura(s).`
							);
							res.json({ ok: true, total: catalogoTexturasProyecto.length });
						}
					);

					app.post(
						"/model-validation",
						(req, res) => {
							const data = req.body || {};
							const requestId = String(data.requestId || data.request_id || "");
							const espera = esperasModelos.get(requestId);
							if (!espera) {
								return res.status(404).json({ ok: false, error: "No hay una verificación de modelos pendiente para ese requestId." });
							}
							esperasModelos.delete(requestId);
							const resultados = Array.isArray(data.results) ? data.results.slice(0, 20) : [];
							espera(resultados);
							return res.json({ ok: true, total: resultados.length });
						}
					);

					app.post(
						"/texture-validation",
						(req, res) => {
							const data = req.body || {};
							const requestId = String(data.requestId || data.request_id || "");
							const espera = esperasTexturas.get(requestId);
							const resultados = Array.isArray(data.results)
							? data.results
							: Array.isArray(data.textures)
							? data.textures
							: [];

							if (!espera) {
								return res.json({ ok: true, ignorado: true });
								}

								esperasTexturas.delete(requestId);
								espera(resultados.slice(0, 200));

								console.log(
									`[RobloxAI] 🔎 Studio confirmó la carga de ${resultados.length} textura(s).`
								);
								res.json({ ok: true });
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

					app.use(expressErrorMiddleware("RobloxAI"));

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

					console.info(
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
									let mensajeUsuario =
									texto;

								const imagenPendiente =
									consumirImagenPendiente();

								if (imagenPendiente) {
									mensajeUsuario =
										`${texto} imagen: "${imagenPendiente}"`;
									console.log(
										`[RobloxAI] Imagen adjuntada desde ./entradas: ${path.basename(imagenPendiente)}`
									);
								} else if (hayImagenPendiente()) {
									console.log(
										"[RobloxAI] Hay una imagen en ./entradas que se adjuntará a la próxima petición de VFX."
									);
								}

								await procesarVFX(
									mensajeUsuario,
									esSoloAnalisis(
										texto
									)
								);
							} else {
								if (hayImagenPendiente()) {
									console.log(
										"[RobloxAI] Hay una imagen en ./entradas; se adjuntará a la próxima petición de VFX."
									);
								}
	await responderChat(
		texto
	);
	}
	}

	rl.close();

	process.exit(0);

