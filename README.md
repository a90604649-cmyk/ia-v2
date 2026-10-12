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
- No hay un bucle de captura de viewport implementado y verificado en esta rama; por tanto, la IA no puede afirmar que ha evaluado visualmente el resultado.
- Una prueba de juego no sustituye la revisión visual.
- No se garantiza que toda respuesta del modelo sea válida; hay que verificar las acciones en el plugin y el registro de Studio.

## Requisitos

- Node.js 18 o superior.
- OmniRoute disponible en la máquina local con un endpoint compatible con OpenAI Chat Completions.
- Plugin Roblox AI Bridge instalado en Roblox Studio.
- HTTP requests habilitadas para Studio cuando corresponda.

## Configuración

Crea `ia/.env` a partir de `ia/.env.example` si está presente en tu clon, o crea el archivo con estas variables:

```env
OMNIROUTE_API_KEY=tu_clave_de_omniroute
OMNIROUTE_URL=http://127.0.0.1:20128/v1/chat/completions
OMNIROUTE_MODEL=auto
OMNIROUTE_ENABLED=true
OMNIROUTE_TIMEOUT_MS=300000
OMNIROUTE_PROGRESS=true

PORT=3000
PROJECT_CONTEXT_PORT=3001
PROJECT_CONTEXT_HOST=0.0.0.0
```

La clave se guarda solo en `.env`. No la pegues en el código ni la subas a GitHub.

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
- `POST /project-scan` recibe el escaneo del proyecto.
- `GET /project-context` devuelve contexto relevante del proyecto.

Consulta `PROJECT_LOG.md` para el estado de trabajo y las pruebas pendientes.
