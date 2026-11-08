# R6 Live Animator

Animador de IA para Roblox Studio. El dummy R6 seleccionado es el espacio de trabajo: la IA genera poses/keyframes de forma incremental y el plugin los aplica al rig mientras llegan. No crea primero un archivo terminado para importarlo al final.

## Comportamiento

1. Seleccionar un Model R6 en Roblox Studio.
2. Escribir una descripción de movimiento en el panel del plugin.
3. El plugin inspecciona las seis articulaciones R6 y las dimensiones/transformaciones de las partes.
4. Antigravity transmite fragmentos de texto al servidor local mediante Interactions API.
5. El servidor convierte esos fragmentos en mensajes NDJSON de keyframes; el plugin aplica cada keyframe al dummy y actualiza una `KeyframeSequence` incrementalmente.
6. En el 80%, el sistema se detiene y espera la aprobación.
7. Al aprobar, Antigravity genera el tramo final y termina la secuencia.

## Requisitos

- Node.js 18 o superior.
- Una clave de Google AI Studio con acceso a Interactions API y al agente Antigravity configurado.
- El plugin de Studio debe permitir comunicación HTTP con el puente local `http://127.0.0.1:3000`; consulta el servidor cada 300 ms.

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
npm start
```

## Instalar el plugin

Carga `ia/RobloxAIBridgePlugin.lua` como plugin local de Roblox Studio. Selecciona el dummy R6 y abre **R6 Live Animator** desde la barra de herramientas.

## Estado de esta versión

Se ha probado la conexión de Interactions API y la recepción de eventos SSE de Antigravity, incluyendo `step.delta` y `interaction.completed`. La integración con el protocolo NDJSON del animador y la comprobación real de movimiento en viewport, creación incremental de `KeyframeSequence` y pausa al 80% todavía deben validarse en Roblox Studio antes de considerar la versión estable.

## Estructura

- `ia/RobloxAIBridgePlugin.lua` — interfaz de Studio, inspección R6 y aplicación de keyframes en vivo.
- `ia/server.js` — API local y sesiones de animación.
- `ia/modelProvider.js` — conexión segura con Antigravity Interactions API y lectura de streaming SSE.
- `ia/animation.js` — fases de vista previa y acabado tras aprobación.
- `ia/animationCore.js` — prompts NDJSON, validación y progreso.
- `ia/animationConfig.js` — reglas de animación R6.
- `ia/r6.js` — validación de rig R6.
