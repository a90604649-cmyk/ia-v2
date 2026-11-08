# R6 Live Animator

Animador de IA para Roblox Studio. La IA envía acciones de articulación en streaming y el plugin mueve los Dummys seleccionados mientras construye sus clips.

## Comportamiento

1. Selecciona uno o dos Models R6 en Roblox Studio. Para dos, selecciónalos juntos en Explorer usando Ctrl.
2. Escribe qué debe ocurrir. Describe el papel de cada Dummy cuando haya dos.
3. El plugin inspecciona los rigs y los envía en una sola solicitud.
4. Antigravity genera una línea de tiempo completa, con los mismos tiempos para ambos rigs.
5. El plugin espera a tener el frame de cada Dummy para un mismo instante y luego inicia sus movimientos simultáneamente.
6. Cada rig recibe un `KeyframeSequence` dentro de su propio `Model/AnimSaves`. Moon Animator 2 usa esta estructura de clips por rig; los dos clips comparten las mismas marcas de tiempo para mantener la sincronía.
7. La generación llega al 100% sin pausa ni aprobación intermedia. El botón Cancelar sigue disponible durante la generación.

La integración usa el formato `KeyframeSequence` y la carpeta `AnimSaves` de los rigs, no la API interna no oficial de Moon Animator. Por ello crea clips compatibles por rig, con tiempo sincronizado; no intenta manipular ventanas ni controles privados del timeline de Moon Animator.

## Requisitos

- Node.js 18 o superior.
- Una clave de Google AI Studio con acceso a Interactions API y al agente Antigravity configurado.
- El plugin de Studio debe permitir comunicación HTTP con el puente local `http://127.0.0.1:3000`.

## Configuración local

Desde la carpeta `ia`:

```powershell
Copy-Item .env.example .env
```

Edita `.env` y coloca tu clave:

```env
GEMINI_API_KEY=tu_clave
ANTIGRAVITY_AGENT=antigravity-preview-latest
HOST=127.0.0.1
PORT=3000
```

La variable `GEMINI_API_KEY` conserva su nombre por compatibilidad con la configuración existente, pero ahora autentica la llamada a Interactions API. No guardes ni compartas la clave en el archivo Lua del plugin ni en Git.

Instala y ejecuta:

```powershell
npm install
npm test
npm start
```

## Instalar el plugin

Carga `ia/RobloxAIBridgePlugin.lua` como plugin local de Roblox Studio. Selecciona uno o dos Dummys R6 y abre **R6 Live Animator** desde la barra de herramientas.

## Clips de Moon Animator 2

Al terminar, revisa en Explorer cada Dummy:

```
DummyA
└── AnimSaves
    └── NombreDeAnimacion_DummyA (KeyframeSequence)

DummyB
└── AnimSaves
    └── NombreDeAnimacion_DummyB (KeyframeSequence)
```

Los clips de ambos rigs reciben los mismos tiempos. Moon Animator guarda y reconoce secuencias `KeyframeSequence` dentro de `AnimSaves` en el rig. Para editar los dos en un mismo proyecto, abre Moon Animator y carga los dos rigs/clips en esa sesión; la integración actual prepara y sincroniza los clips, pero no llama a su API interna privada.

## Estructura

- `ia/RobloxAIBridgePlugin.lua` — selección de uno o dos rigs, vista previa simultánea y guardado de clips.
- `ia/server.js` — API local y sesiones de animación.
- `ia/modelProvider.js` — conexión segura con Antigravity Interactions API y lectura de streaming SSE.
- `ia/animation.js` — generación de toda la línea de tiempo con cierres sincronizados por rig.
- `ia/animationCore.js` — protocolo NDJSON, prompts y validación de poses.
- `ia/animationConfig.js` — reglas de animación R6.
- `ia/r6.js` — validación de rigs R6.
