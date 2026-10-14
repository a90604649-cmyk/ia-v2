# Roblox VFX Authoring Bridge

Herramienta especializada para crear y refinar efectos visuales directamente en Roblox Studio mediante OmniRoute y un plugin de Studio. El objetivo no es generar scripts para que el usuario los ejecute: es construir la jerarquía visual y configurar sus propiedades dentro del proyecto abierto.

## Alcance actual

- Crear y organizar instancias visuales en modo edición.
- Configurar propiedades tipadas como Vector3, Color3, CFrame, NumberRange, NumberSequence y ColorSequence.
- Trabajar con piezas auxiliares, Attachments, ParticleEmitters, Beams, Trails y luces compatibles con el bridge.
- Consultar el catálogo de objetos real del proyecto para respetar rutas existentes.
- Mantener los cambios separados en la rama `vfx-specialization`.

## Límites que todavía deben probarse

- La creación y asignación de propiedades aún debe verificarse en Roblox Studio real.
- El servidor ya tiene el receptor de capturas y la lógica de revisión visual acotada, pero todavía falta conectar la captura y el envío desde el plugin de Studio. Hasta que se pruebe ese recorrido completo, la IA no puede afirmar que ha evaluado visualmente el resultado.
- Una prueba de juego no sustituye la revisión visual.
- No se garantiza que toda respuesta del modelo sea válida; hay que verificar las acciones en el plugin y el registro de Studio.

## Requisitos

- Node.js 18 o superior.
- OmniRoute disponible en la máquina local con un endpoint compatible con OpenAI Chat Completions.
- Plugin Roblox AI Bridge instalado en Roblox Studio.
- HTTP requests habilitadas para Studio cuando corresponda.

## Configuración

Desde la carpeta `ia/`, copia `.env.example` como `.env` (en Windows PowerShell: `Copy-Item .env.example .env`) y reemplaza `pega_tu_clave_local_aqui` por tu clave de OmniRoute:

```env
OMNIROUTE_API_KEY=tu_clave_de_omniroute
OMNIROUTE_URL=http://127.0.0.1:20128/v1/chat/completions
OMNIROUTE_MODEL=nvidia/nvidia/nemotron-3-ultra-550b-a55b
OMNIROUTE_TIMEOUT_MS=300000
OMNIROUTE_REASONING_EFFORT=none

PORT=3000
PROJECT_CONTEXT_PORT=3001
PROJECT_CONTEXT_HOST=0.0.0.0
BRIDGE_INPUT_PORT=3030
```

La clave se guarda solo en `.env`. No la pegues en el código ni la subas a GitHub. `OMNIROUTE_API_KEY` debe seguir siendo la clave local de OmniRoute; la credencial de NVIDIA se configura dentro de OmniRoute. El modelo de ejemplo es `nvidia/nvidia/nemotron-3-ultra-550b-a55b`, que debe aparecer disponible en el catálogo de tu instancia. El bridge no fija `max_tokens`; OmniRoute y el proveedor aplican sus cuotas propias. Para errores de cola con `reset after Ns`, el bridge reintenta hasta tres intentos y espera el intervalo indicado más un segundo. Esto mejora el reintento, pero no evita que un proveedor saturado siga fallando. Si ya tienes un `.env` creado, editar `.env.example` no lo modifica: abre `ia/.env` y cambia manualmente la línea `OMNIROUTE_MODEL` a `nvidia/nvidia/nemotron-3-ultra-550b-a55b`. Conserva `OMNIROUTE_API_KEY` como tu clave local de OmniRoute.

## Ejecución

Desde la carpeta `ia/`:

```bash
npm install
npm start
```

El bridge escucha en `http://127.0.0.1:3000` y el contexto del proyecto usa el puerto `3001`.

## Flujo

Usuario describe un VFX → modelo diseña las capas → OmniRoute devuelve acciones estructuradas → el bridge aplica instancias y propiedades en Studio → se revisan errores y apariencia por separado.

## Acciones de instancia

- `create_instance`
- `set_property`
- `set_properties`
- `rename_instance`
- `move_instance`
- `delete_instance` solo para eliminaciones solicitadas explícitamente

La IA especializada no debe crear scripts, remotes ni pruebas de juego como sustituto del efecto.

## Endpoints

- `GET /` estado general del bridge.
- `GET /health` estado de configuración del proveedor.
- `GET /next` entrega las acciones pendientes al plugin.
- `POST /execution-results` recibe el resultado real de las acciones aplicadas por el plugin.
- `POST /visual-capture` recibe una captura PNG del viewport para revisión visual.
- `POST /project-scan` recibe el escaneo del proyecto.
- `GET /project-context` devuelve contexto relevante del proyecto.

Consulta `PROJECT_LOG.md` para el estado de trabajo y las pruebas pendientes.
