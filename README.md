# R6 Live Animator

Animador de IA para Roblox Studio. El dummy R6 seleccionado es el espacio de trabajo: la IA genera poses/keyframes de forma incremental y el plugin los aplica al rig mientras llegan. No crea primero un archivo terminado para importarlo al final.

## Comportamiento

1. Seleccionar un Model R6 en Roblox Studio.
2. Escribir una descripción de movimiento en el panel del plugin.
3. El plugin inspecciona las seis articulaciones R6 y las dimensiones/transformaciones de las partes.
4. Gemini 4 Argon transmite keyframes NDJSON al servidor local.
5. El plugin aplica cada keyframe al dummy en el viewport y actualiza una `KeyframeSequence` incrementalmente.
6. En el 80%, el sistema se detiene y espera la aprobación.
7. Al aprobar, Argon genera el tramo final y termina la secuencia.

## Requisitos

- Roblox Studio actualizado con soporte para `HttpService:CreateWebStreamClient` no es obligatorio en esta versión: el plugin consulta el puente local cada 300 ms.
- Node.js 18 o superior.
- Una clave Gemini API con acceso al modelo `gemini-4-argon`.
- Permitir al plugin comunicarse con `http://127.0.0.1:3000` cuando Studio lo solicite.

## Configuración local

Desde la carpeta `ia`:

```powershell
Copy-Item .env.example .env
```

Edita `.env` y coloca tu clave:

```env
GEMINI_API_KEY=tu_clave
GEMINI_MODEL=gemini-4-argon
GEMINI_THINKING_LEVEL=HIGH
HOST=127.0.0.1
PORT=3000
```

No guardes ni compartas la clave en el archivo Lua del plugin ni en Git.

Instala y ejecuta:

```powershell
npm install
npm start
```

## Instalar el plugin

Carga `ia/RobloxAIBridgePlugin.lua` como plugin local de Roblox Studio. Selecciona el dummy R6 y abre **R6 Live Animator** desde la barra de herramientas.

## Estado de esta versión

Esta es la base inicial del pipeline en vivo. La comprobación real de movimiento en viewport, la creación incremental de `KeyframeSequence` y la pausa al 80% deben validarse en Roblox Studio con un dummy R6 real antes de considerar la versión estable.

## Estructura

- `ia/RobloxAIBridgePlugin.lua` — interfaz de Studio, inspección R6 y aplicación de keyframes en vivo.
- `ia/server.js` — API local y sesiones de animación.
- `ia/modelProvider.js` — conexión segura por servidor con Gemini API y lectura de streaming.
- `ia/animation.js` — fases de vista previa y acabado tras aprobación.
- `ia/animationCore.js` — prompts NDJSON, validación y progreso.
- `ia/animationConfig.js` — reglas de animación R6.
- `ia/r6.js` — validación de rig R6.
