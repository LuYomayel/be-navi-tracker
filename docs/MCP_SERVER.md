# NaviTracker · Servidor MCP para Claude

NaviTracker expone un **servidor MCP remoto** (Model Context Protocol) para que
Claude pueda loguear comidas, hábitos, peso, hidratación y tareas, y leer el
resumen del día, **desde el celu y la compu**.

El MCP **no reemplaza** la API de NaviTracker: es una capa fina que registra
"tools" y por dentro reutiliza los servicios de dominio existentes
(`NutritionService`, `HydrationService`, `CompletionsService`, etc.). Una sola
fuente de verdad.

## Arquitectura

```
Claude (celu / web)
   │  HTTPS · Streamable HTTP · Bearer token (OAuth 2.1 + PKCE)
   ▼
POST /mcp                         ← endpoint MCP (Streamable HTTP)
GET  /.well-known/oauth-*         ← discovery metadata (RFC 9728 / 8414)
/oauth/authorize · /oauth/token · /oauth/register   ← Authorization Server
   │  resuelve el userId del token y llama a los servicios internos
   ▼
Servicios de NaviTracker (nutrición, hábitos, hidratación, tareas, day-score)
   ▼
Base de datos
```

Todo vive dentro del mismo backend NestJS (módulo `src/modules/mcp/`). Las rutas
`/mcp`, `/.well-known/oauth-*` y `/oauth/*` están **excluidas del prefijo global
`/api`** (ver `src/main.ts`) porque Claude las espera en la raíz del dominio.

## Tools disponibles

### Escritura (loguear)

| Tool           | Inputs                                                                   | Hace                                            |
| -------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| `log_comida`   | tipo, detalle, fecha?, calorias?, proteina_g?, carbos_g?, grasa_g?, fibra_g?, notas? | Registra una comida en el diario nutricional    |
| `set_habito`   | habito, hecho?, fecha?                                                    | Marca/desmarca un hábito por nombre             |
| `log_peso`     | peso_kg, grasa_corporal_pct?, masa_muscular_pct?, agua_pct?, notas?       | Registra peso/medición (fecha de hoy)           |
| `set_agua`     | vasos, fecha?                                                            | Fija los vasos de agua del día (absoluto)       |
| `agregar_agua` | delta, fecha?                                                            | Suma/resta vasos de agua a lo ya registrado     |
| `crear_tarea`  | titulo, descripcion?, fecha?, hora?, prioridad?, categoria?              | Crea una tarea/pendiente                        |

### Lectura (briefing)

| Tool              | Inputs        | Hace                                                          |
| ----------------- | ------------- | ------------------------------------------------------------ |
| `list_habitos`    | —             | Lista los hábitos activos y en qué días aplican              |
| `get_resumen_dia` | fecha?        | Comidas + macros vs objetivo, agua, hábitos, tareas y score  |
| `get_plan_hoy`    | fecha?        | Hábitos programados + tareas pendientes del día              |
| `get_comidas`     | desde, hasta  | Lista de comidas en un rango (para informes)                 |
| `get_day_score`   | fecha?        | Puntaje del día (won/partial/lost)                           |

Cuando no se pasa `fecha`, se usa **hoy** en zona horaria de Argentina.

## Autenticación (OAuth 2.1 + PKCE)

Como los datos son privados, `/mcp` exige un Bearer token. El flujo:

1. Claude lee `GET /.well-known/oauth-protected-resource` → descubre el
   Authorization Server.
2. Lee `GET /.well-known/oauth-authorization-server` → endpoints + que soporta
   PKCE `S256` y Dynamic Client Registration.
3. (Opcional) `POST /oauth/register` (DCR, RFC 7591) → obtiene un `client_id`.
   Si no usás DCR, cargás un `client_id` manual en "Advanced settings".
4. `GET /oauth/authorize` → muestra un login de NaviTracker (email + contraseña).
   Claude **nunca** ve la contraseña.
5. Tras el login válido se emite un **authorization code** (un solo uso, 10 min).
6. `POST /oauth/token` con `code_verifier` (PKCE) → devuelve `access_token`
   (JWT de NaviTracker) + `refresh_token`.
7. Cada `POST /mcp` valida el Bearer token y resuelve el `userId`.

El access token es el **mismo JWT** que usa la web app (firmado con `JWT_SECRET`),
así que `/mcp` lo valida con la infraestructura de auth existente.

> **Nota sobre persistencia:** los clientes DCR y los authorization codes se
> guardan **en memoria** (`McpAuthService`). Es suficiente para una sola
> instancia; si se reinicia el proceso, Claude se re-registra / re-autoriza.
> Para múltiples instancias o persistencia, mover esos mapas a la base
> (modelos Prisma `OAuthClient` / `OAuthCode`).

## Variables de entorno

| Variable             | Default                  | Descripción                                                        |
| -------------------- | ------------------------ | ------------------------------------------------------------------ |
| `MCP_AUTH_MODE`      | `oauth`                  | `oauth` (producción) o `none` (authless, solo para dev/Inspector). |
| `MCP_BASE_URL`       | _(inferido del request)_ | URL pública del server para la metadata OAuth. Ej: `https://navi-tracker.luciano-yomayel.com`. |
| `MCP_STATIC_USER_ID` | —                        | Usuario asociado al modo authless / token estático.                |
| `MCP_STATIC_TOKEN`   | —                        | Bearer fijo opcional para pruebas rápidas.                         |
| `MCP_ACCESS_TTL`     | `3600`                   | Vida del access token en segundos.                                 |
| `MCP_REFRESH_TTL`    | `2592000`                | Vida del refresh token en segundos (30 días).                      |
| `JWT_SECRET`         | _(ya existente)_         | Se reutiliza para firmar/validar el access token.                  |
| `JWT_REFRESH_SECRET` | _(ya existente)_         | Se reutiliza para el refresh token.                                |

En producción, definí `MCP_BASE_URL` para que la metadata OAuth use exactamente
el dominio público (importante detrás de proxy/CDN).

## Probar en local

### Authless + MCP Inspector (rápido)

```bash
export MCP_AUTH_MODE=none
export MCP_STATIC_USER_ID=<id-de-un-usuario-real>
npm run start:dev
# En otra terminal:
npx @modelcontextprotocol/inspector
# Conectar a http://localhost:4000/mcp (Streamable HTTP), sin auth.
```

### Con OAuth (como lo ve Claude)

1. `npm run start:dev` (sin `MCP_AUTH_MODE=none`).
2. Verificá la metadata:
   ```bash
   curl http://localhost:4000/.well-known/oauth-protected-resource
   curl http://localhost:4000/.well-known/oauth-authorization-server
   ```
3. El Inspector también soporta el flujo OAuth completo apuntando a `/mcp`.

## Registrar el connector en Claude

1. En **web o desktop**: Settings → Connectors → **Add custom connector**.
2. URL: `https://navi-tracker.luciano-yomayel.com/mcp`
3. Con DCR no hace falta cargar nada; con `client_id` manual, usá "Advanced
   settings".
4. **Add** → te lleva al login de NaviTracker (OAuth) → autorizás.
5. Queda disponible **también en el celu** (el connector se *agrega* desde
   web/desktop, pero se *usa* desde donde quieras).

Requisitos: dominio público con **HTTPS válido** y plan Pro/Max/Team/Enterprise.

## Tests

```bash
npx jest src/modules/mcp        # PKCE, codes, DCR, emisión/validación de tokens
```
