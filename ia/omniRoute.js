import "dotenv/config";

const OMNIROUTE_URL = String(
	process.env.OMNIROUTE_URL ||
	"http://127.0.0.1:20128/v1/chat/completions"
).trim();

const OMNIROUTE_MODEL = String(
	process.env.OMNIROUTE_MODEL ||
	"nvidia/nvidia/nemotron-3-ultra-550b-a55b"
).trim() || "nvidia/nvidia/nemotron-3-ultra-550b-a55b";

const DEFAULT_TIMEOUT_MS = Math.max(
	5000,
	Number(process.env.OMNIROUTE_TIMEOUT_MS || 300000)
);

const PROJECT_CONTEXT_PORT = Number(
	process.env.PROJECT_CONTEXT_PORT || 3001
);

const EXTENDED_MARKER = "__ROBLOX_AI_EXTENDED_ACTION__";

const EXTENDED_ACTIONS = new Set([
	"create_instance",
	"delete_instance",
	"set_property",
	"set_properties",
	"run_studio_test",
	"rename_instance",
	"move_instance"
	]);

const PROPERTY_NAMES = new Set([
	"Enabled",
	"Anchored",
	"CanCollide",
	"CanTouch",
	"CanQuery",
	"Transparency",
	"Reflectance",
	"CastShadow",
	"Massless",
	"Locked",
	"Size",
	"Position",
	"Orientation",
	"CFrame",
	"Color",
	"Material",
	"Shape",
	"Name",
	"Visible",
	"Active",
	"BackgroundTransparency",
	"BorderSizePixel",
	"TextTransparency",
	"TextSize",
	"ImageTransparency",
	"Value",
	"WalkSpeed",
	"JumpPower",
	"AutoRotate",
	"RequiresHandle",
	"CanBeDropped",
	"FieldOfView",
	"MaxActivationDistance",
	"Brightness",
	"ClockTime",
	"Ambient",
	"OutdoorAmbient",
	"ExposureCompensation"
	]);

const EXTENDED_VFX_RULES = [
"Especialización estricta: creación y refinamiento de VFX/PFX dentro de Roblox Studio; no programación general.",
"Acciones admitidas para este proyecto: create_instance, set_property, set_properties, rename_instance y move_instance. delete_instance solo ante una petición explícita de borrar.",
"No crear Script, LocalScript, ModuleScript, RemoteEvent ni RemoteFunction; no usar run_studio_test para juzgar apariencia.",
"Para crear un efecto, crea primero Model/Folder contenedor, luego piezas y Attachments, y finalmente ParticleEmitter/Beam/Trail que dependan de ellos.",
"Usa rutas reales del proyecto; path identifica el contenedor padre, name el objeto nuevo y className la clase Roblox.",
"Para modificar propiedades usa set_property/set_properties; no uses Parent como propiedad, usa move_instance.",
"No declares una captura, inspección visual o corrección visual completada sin evidencia real.",
"No inventes herramientas como get_source o read_source.",
"IMAGEN + BÚSQUEDA: antes de construir un VFX completo desde cero, compara el análisis visual con la estructura real de los VFX y recursos que aparecen en el contexto. Reutiliza solo los que puedan conservar la silueta y los rasgos principales, no solo por su nombre. Si no hay un efecto ni un conjunto adaptable suficientemente parecido, emite buscar_texturas como PRIMERA acción y espera el resultado. Usa tipo=modelo cuando necesitas una forma o VFX completo; las miniaturas disponibles se comparan visualmente con la referencia y los modelos se cargan temporalmente en Studio para verificar que contienen objetos visuales y no scripts/remotes. Cargar un asset no significa que sea parecido; si no hay candidato adecuado, no finjas que lo encontraste.",

 "TEXTURA: un ParticleEmitter sin Texture valida es invisible. Nunca inventes rbxassetid://. Tienes tres fuentes validas, por orden de preferencia: 1) el CATÁLOGO DE TEXTURAS VERIFICADAS del contexto (ids que ya cargan en este proyecto); 2) la biblioteca ReplicatedStorage/VFXTextures o texturas que ya existan en el proyecto; 3) si ninguna encaja con el efecto, emite UNA accion {\"type\":\"buscar_texturas\",\"keyword\":\"...\",\"cantidad\":10} y el servidor consultara el catálogo público de Roblox, validará los ids en Studio y te devolverá los que cargan de verdad. No repitas la misma búsqueda dos veces y nunca la uses más de una vez por consulta.",
 "MODELOS DEL CATÁLOGO: si lo que falta es una FORMA que no sabes construir con Parts (humo con volumen, telaraña, cristal, hierba, arma, armadura), anade \"tipo\":\"modelo\" a esa misma accion buscar_texturas. El servidor busca MODELOS en el catálogo público de Roblox y pide al plugin cargarlos temporalmente en Studio para comprobar que cada asset puede cargarse y contiene instancias visuales. Descarta candidatos no cargables o que incluyan scripts/remotes; solo después inserta el primer candidato validado en Workspace/VFXCatalogo y te devuelve su assetId. Esta comprobación no demuestra que el modelo se parezca visualmente a la imagen. Tu nunca emitas una accion insertar_modelo: la inserta el servidor.",
"JERARQUIA: ParticleEmitter/Beam/Trail/Fire/Smoke/Sparkles y PointLight/SpotLight/SurfaceLight deben ser hijos DIRECTOS de una BasePart o un Attachment; dentro de un Folder no emiten ni iluminan.",
 "IMAGEN DE REFERENCIA: si el contexto trae un ANALISIS VISUAL DE LA IMAGEN, el efecto debe parecerse a esa imagen por su FORMA, no solo por el brillo. Lee su bloque ESTRUCTURA / PLANO / PALETA / PARTICULAS y construye esa silueta con geometria real de Parts ANTES de las particulas. Para una figura plana tumbada en el suelo (anillo, circulo, disco, espiral, estrella): un Part Anchored por capa con Size = Vector3 (D, G, D), siendo D el diametro que diga el analisis y G un grosor fino; El eje fino es Y únicamente si la referencia muestra la figura horizontal; si aparece de pie o en otro plano, orienta el Part de acuerdo con la imagen. Transparency = 1, CanCollide = false, Material = SmoothPlastic, y DENTRO un Decal con Face = Top (Enum.NormalId.Top) y Texture del catalogo; sin ese Decal la figura no dibuja nada. Elige la textura por lo que representa, NUNCA por el nombre de su carpeta: las carpetas del catalogo indican donde se usa cada textura, no que es la textura. Si ninguna encaja, emite buscar_texturas como PRIMERA accion con un keyword descriptivo. Con varias capas, un Part plano por capa con el MISMO centro y los diametros del analisis. PROHIBIDO resolver una figura plana con una esfera, un globo de luz, un Material ForceField o un SpecialMesh esferico. Usa la PALETA observada en Decal.Color3, ParticleEmitter.Color y PointLight.Color, y pon las particulas ENCIMA de la geometria, nunca en su lugar. Si el proyecto ya tiene un efecto parecido, revisa su estructura real antes de duplicarlo. El bridge envía una proyección sintética de la geometría junto con un resumen de propiedades: úsala solo para comparar aproximadamente silueta, proporciones, posiciones y paleta. No es una captura real del viewport y no representa píxeles de texturas, iluminación, sombras ni partículas simuladas; no declares una coincidencia visual completa a partir de ella.",
"RATE: en esta rama no hay scripts que disparen Emit(), asi que un ParticleEmitter con Rate = 0 nunca emite y el VFX queda invisible. Pon SIEMPRE un Rate mayor que 0 (fuego 50-80, chispas 60-100, humo 8-15, anillos 15-25). El bridge rechaza Rate = 0.",
"EmissionDirection de ParticleEmitter NO tiene enum propio: usa Enum.NormalId, es decir {\"type\":\"Enum\",\"enum\":\"NormalId\",\"value\":\"Top\"} con valores Top, Bottom, Front, Back, Left, Right. Enum.EmissionDirection no existe.",

].join("\n");

function limpiarMarkdownJson(texto) {
	return String(texto || "")
		.trim()
		.replace(/^```json\s*/i, "")
			.replace(/^```\s*/i, "")
				.replace(/\s*```$/i, "")
					.trim();
					}

	function parsearLiteralSimple(texto) {
		const value = String(texto || "").trim();

		if (value === "true") {
			return true;
			}

			if (value === "false") {
				return false;
				}

				if (/^-?\d+(?:\.\d+)?$/.test(value)) {
					return Number(value);
					}

					if (
						(value.startsWith('"') && value.endsWith('"')) ||
						(value.startsWith("'") && value.endsWith("'"))
						) {
							return value.slice(1, -1);
						}

						return null;
						}

		function convertirAsignacionPropiedadEnAccion(action) {
			if (
				!action ||
				typeof action !== "object" ||
				!String(action.type || "").startsWith("update_")
			) {
					return action;
				}

				const code =
				typeof action.code === "string"
				? action.code
				: "";

				if (!code.trim()) {
					return action;
					}

					const lines = code
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(
						(line) =>
						line &&
						!line.startsWith("--") &&
						!line.startsWith("--[")
					);

					if (lines.length === 0) {
						return action;
						}

						const properties = {};

						for (const line of lines) {
							const match = line.match(
								/^(?:[A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)?\.(\w+)\s*=\s*(.+)$/
							);

							if (!match) {
								return action;
								}

								const property = match[1];
								const literal = parsearLiteralSimple(match[2]);

								if (!PROPERTY_NAMES.has(property) || literal === null) {
									return action;
									}

									properties[property] = literal;
									}

							const entries = Object.entries(properties);

							if (entries.length === 0) {
								return action;
								}

								if (entries.length === 1) {
									const [property, value] = entries[0];

									return {
										type: "set_property",
										path: action.path,
										name: action.name,
										className: action.className,
										property,
										value
									};
									}

									return {
										type: "set_properties",
										path: action.path,
										name: action.name,
										className: action.className,
										properties
									};
									}

				function crearTestId() {
					return `test_${Date.now()}_${Math.random()
					.toString(36)
					.slice(2, 8)}`;
					}

					function normalizarRunStudioTest(action) {
						const numPlayers = Math.max(
							1,
							Math.min(
								8,
								Number(action.numPlayers || action.players || 2)
							)
						);

						const duration = Math.max(
							3,
							Math.min(
								60,
								Number(action.duration || 10)
							)
						);

						const serverCode = String(
							action.serverCode || ""
						).trim();

						const clientCode = String(
							action.clientCode || ""
						).trim();

						if (!serverCode && !clientCode) {
							return null;
							}

							return {
								type: "run_studio_test",
								testId: String(
									action.testId || crearTestId()
								),
								numPlayers,
								duration,
								serverCode,
								clientCode
							};
							}

						function empaquetarAccionExtendida(action) {
							const type = String(
								action.type || ""
							).trim().toLowerCase();

							let payload = {
								...action,
								type,
								__extended: true
							};

							if (type === "run_studio_test") {
								payload = normalizarRunStudioTest(action);

								if (!payload) {
									return null;
									}

									payload.__extended = true;
									}

								return {
									type: "update_script",
									className: "Script",
									name: String(
										action.name ||
										"__RobloxAIBridgeExtendedAction__"
									),
									path: String(
										action.path ||
										"ReplicatedStorage"
									),
									code:
									`${EXTENDED_MARKER}\n` +
									JSON.stringify(payload)
								};
								}

							function adaptarAccionesExtendidas(objeto) {
								if (
									!objeto ||
									typeof objeto !== "object" ||
									!Array.isArray(objeto.actions)
								) {
									return objeto;
								}

								objeto.actions = objeto.actions
								.map((action) => {
									const normalizada =
									convertirAsignacionPropiedadEnAccion(action);

									if (
										!normalizada ||
										typeof normalizada !== "object"
										) {
											return action;
										}

										const type = String(
											normalizada.type || ""
										).trim().toLowerCase();

										if (type === "run_studio_test") {
											const test = normalizarRunStudioTest(
												normalizada
											);

											return test
											? empaquetarAccionExtendida(test)
											: null;
											}

											return EXTENDED_ACTIONS.has(type)
											? empaquetarAccionExtendida(normalizada)
											: normalizada;
								})
								.filter(Boolean);

								return objeto;
								}

								async function enriquecerMensajesVFX(messages) {
									if (!Array.isArray(messages)) {
										return messages;
									}

									const esVFX = messages.some(
										(message) =>
										message?.role === "system" &&
										/artista técnico senior especializado EXCLUSIVAMENTE en crear y refinar efectos visuales/i.test(
											String(message.content || "")
										)
									);

									if (!esVFX) {
										return messages;
										}

										const enriched = messages.map((message) => ({
											...message
										}));

										const systemIndex = enriched.findIndex(
											(message) =>
											message?.role === "system" &&
											/artista técnico senior especializado EXCLUSIVAMENTE en crear y refinar efectos visuales/i.test(
												String(message.content || "")
											)
										);

										if (systemIndex >= 0) {
											enriched[systemIndex].content = [
											String(
												enriched[systemIndex].content || ""
											),
											EXTENDED_VFX_RULES
											].join("\n\n");
											}

											const userIndex = [...enriched]
											.map((message, index) => ({
												message,
												index
											}))
											.reverse()
											.find(
												(item) =>
												item.message?.role === "user"
											)?.index;

											if (userIndex == null) {
												return enriched;
												}

												const userContent = enriched[userIndex].content;
												const query = (
													typeof userContent === "string"
													? userContent
													: Array.isArray(userContent)
													? userContent.filter((part) => part?.type === "text").map((part) => String(part.text || "")).join("\n")
													: String(userContent || "")
												).slice(-12000);

												try {
													const response = await fetch(
														`http://127.0.0.1:${PROJECT_CONTEXT_PORT}/project-context?query=${encodeURIComponent(query)}`,
														{
															headers: {
																Accept: "application/json"
															},
															signal: AbortSignal.timeout(8000)
														}
													);

													if (!response.ok) {
														return enriched;
														}

														const context = await response.json();

														const objects = Array.isArray(
															context?.objects
														)
														? context.objects
														: [];

														if (objects.length === 0) {
															return enriched;
															}

															const lines = objects
															.slice(0, 120)
															.map(
																(object) =>
																`- ${object.className}: ${object.path}/${object.name}`
															)
															.join("\n");

															const contextText = [
															"",
															"CATÁLOGO REAL DE OBJETOS DE ROBLOX STUDIO:",
															lines,
															"Usa únicamente estas rutas y clases como referencia."
															].join("\n");

															if (Array.isArray(enriched[userIndex].content)) {
																enriched[userIndex].content = [
																...enriched[userIndex].content,
																{ type: "text", text: contextText }
																];
																} else {
	enriched[userIndex].content = [
	enriched[userIndex].content,
	contextText
	].join("\n");
	}
	} catch {
		// El contexto principal ya puede venir en el mensaje.
	}

	return enriched;
	}

	export function parsearRespuestaJson(texto) {
		const limpio = limpiarMarkdownJson(texto);

		let objeto = null;

		try {
			objeto = JSON.parse(limpio);
		} catch {
			const inicio = limpio.indexOf("{");
			const fin = limpio.lastIndexOf("}");

			if (
				inicio === -1 ||
				fin <= inicio
				) {
					return null;
				}

				try {
					objeto = JSON.parse(
						limpio.slice(
							inicio,
							fin + 1
						)
					);
				} catch {
					return null;
				}
		}

		return adaptarAccionesExtendidas(objeto);
		}

		function obtenerErrorTexto(data) {
			if (!data) {
				return "Error desconocido de OmniRoute.";
			}

			if (typeof data === "string") {
				return data;
				}

				if (data.error?.message) {
					return String(data.error.message);
					}

					if (data.message) {
						return String(data.message);
						}

						return JSON.stringify(data);
						}

			function crearBody(messages, options) {
				const body = {
					model:
					options.model ||
					OMNIROUTE_MODEL,

					messages:
					Array.isArray(messages)
					? messages
					: [],

					temperature:
					Number.isFinite(
						Number(options.temperature)
					)
					? Number(options.temperature)
					: 0.6,

					stream: false
				};

				if (options.json === true) {
					body.response_format = {
						type: "json_object"
					};
					}

					return body;
					}

				async function fetchJson(options, timeoutMs) {
					const controller =
					new AbortController();

					const timer = setTimeout(
						() => controller.abort(),
						timeoutMs
					);

					try {
						const response = await fetch(
							OMNIROUTE_URL,
							{
								...options,
								signal: controller.signal
							}
						);

						const text =
						await response.text();

						let data = null;

						try {
							data = text
							? JSON.parse(text)
							: null;
						} catch {
							data = text;
						}

						return {
							response,
							data
						};
					} finally {
						clearTimeout(timer);
					}
					}

					function extraerTexto(data) {
						const text =
						data?.choices?.[0]?.message?.content ??
						"";

						if (
							typeof text !== "string" ||
							!text.trim()
							) {
								throw new Error(
									`OmniRoute no devolvió contenido válido: ${obtenerErrorTexto(data)}`
								);
							}

							return text.trim();
							}

						function esReintentable(status, mensaje) {
							const text =
							String(mensaje || "")
							.toLowerCase();

							return (
								[408, 409, 425, 429, 500, 502, 503, 504]
								.includes(Number(status)) ||

								text.includes("timeout") ||
								text.includes("timed out") ||
								text.includes("temporarily") ||
								text.includes("overloaded") ||
								text.includes("unavailable")
							);
							}

							function extraerEsperaColaMs(mensaje) {
								const text = String(mensaje || "").toLowerCase();

								if (!text.includes("queue budget")) {
									return null;
									}

									const match = text.match(/reset after\s+(\d+(?:\.\d+)?)\s*s\b/i);
									if (!match) {
										return null;
										}

										const resetMs = Number(match[1]) * 1000;
										if (!Number.isFinite(resetMs) || resetMs < 0) {
											return null;
											}

											// Espera un segundo adicional para no reintentar justo en el límite.
											return Math.min(30000, Math.max(1000, Math.ceil(resetMs) + 1000));
											}

								function esperar(ms) {
									return new Promise(
										(resolve) => setTimeout(resolve, ms)
									);
									}

									export async function preguntarOmniRoute(
										messages,
										options = {}
									) {
										const key = String(
											process.env.OMNIROUTE_API_KEY || ""
										).trim();

										if (!key) {
											throw new Error(
												"No se encontró OMNIROUTE_API_KEY en el archivo .env"
											);
											}

											const preparedMessages =
											await enriquecerMensajesVFX(
												messages
											);

											const attempts = Math.max(
												1,
												Math.min(
													3,
													Number(
														options.attempts ||
														options.attemptsPerKey ||
														3
													)
												)
											);

											let lastError = null;

											for (
												let attempt = 1;
												attempt <= attempts;
												attempt++
												) {
													try {
														const result =
														await fetchJson(
															{
																method: "POST",

																headers: {
																	Authorization:
																	`Bearer ${key}`,

																	"Content-Type":
																	"application/json",

																	Accept:
																	"application/json"
																},

																body: JSON.stringify(
																	crearBody(
																		preparedMessages,
																		options
																	)
																)
															},

															Number(
																options.timeoutMs ||
																DEFAULT_TIMEOUT_MS
															)
														);

														if (!result.response.ok) {
															const message =
															obtenerErrorTexto(
																result.data
															);

															lastError = new Error(
																`OmniRoute ${result.response.status}: ${message}`
															);

															if (
																esReintentable(
																	result.response.status,
																	message
																) &&
																attempt < attempts
																) {
																	const queueWait = extraerEsperaColaMs(message);
																	const wait = queueWait ?? Math.min(
																		15000,
																		1000 * (2 ** (attempt - 1))
																	);

																	if (queueWait !== null) {
																		console.warn(
																			`[OmniRoute] La cola pidió reiniciar después de un intervalo; reintentando en ${wait} ms (intento ${attempt}/${attempts}).`
																		);
																		}

																		await esperar(wait);
																		continue;
																}

																throw lastError;
																}

															const text =
															extraerTexto(
																result.data
															);

															console.log(
																`✅ OmniRoute respondió con ${
																result.data?.model ||
																OMNIROUTE_MODEL
																}.`
															);

															return text;
													} catch (error) {
														lastError =
														error instanceof Error
														? error
														: new Error(
															String(error)
														);

														const message =
														lastError.message.toLowerCase();

														const networkError =
														message.includes("fetch failed") ||
														message.includes("abort") ||
														message.includes("socket") ||
														message.includes("timeout");

														if (
															(
																networkError ||
																esReintentable(
																	0,
																	message
																)
															) &&
															attempt < attempts
															) {
																const queueWait = extraerEsperaColaMs(message);
																const wait = queueWait ?? Math.min(
																	15000,
																	1000 * (2 ** (attempt - 1))
																);

																if (queueWait !== null) {
																	console.warn(
																		`[OmniRoute] La cola pidió reiniciar después de un intervalo; reintentando en ${wait} ms (intento ${attempt}/${attempts}).`
																	);
																	}

																	await esperar(wait);
																	continue;
															}

															throw lastError;
													}
												}

												throw (
													lastError ||
													new Error(
														"Todas las solicitudes de OmniRoute fallaron."
													)
												);
												}

										export const OMNIROUTE_MODEL_ID =
										OMNIROUTE_MODEL;

										export const OMNIROUTE_CONFIG = {
											model: OMNIROUTE_MODEL,
											url: OMNIROUTE_URL,
											reasoningEffort:
											process.env.OMNIROUTE_REASONING_EFFORT ||
											"none"
										};