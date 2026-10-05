# Artefacto de entrega OpenMuse para RHODIZ

Este documento describe un **candidato de empaquetado**, no un despliegue ni una
certificación. El HIL r7 y el programa global 10/10 son frentes distintos. Un
build, un healthcheck o una prueba con datos sintéticos no certifica ninguno de ellos.

## Autoridad y contrato de rutas

Hermes conserva el núcleo, MemoryOS la memoria canónica y RHODIZ Policy/Action
Fabric la autoridad. El perfil `OPENMUSE_DEPLOYMENT=rhodiz` exige modo live,
autenticación RHODIZ y el endpoint AG-UI canónico. Rechaza worker local, Computer
local, token AG-UI estático y CopilotKit Intelligence. No habilita herramientas en
el puente de texto. El relay de navegador gobernado existente permanece separado.

La web se compila con `EXPO_PUBLIC_WEB_BASE_PATH=/muse`. Sus peticiones REST y
CopilotKit usan el origen real del navegador más ese prefijo; no `localhost`.
El gateway autorizado debe retirar **una sola vez** `/muse` para todos los recursos:

| Petición pública | Petición al servicio interno |
| --- | --- |
| `/muse/` | `/` |
| `/muse/assets/...` | `/assets/...` |
| `/muse/_expo/static/...` | `/_expo/static/...` |
| `/muse/api/health` | `/api/health` |
| `/muse/api/copilotkit/...` | `/api/copilotkit/...` |

El gateway debe redirigir `/muse` a `/muse/`, conservar método, consulta, cuerpo y
bearer, y transmitir SSE sin buffering. Esta integración del gateway **no** se
instala desde este repositorio. Las rutas desconocidas siguen devolviendo 404;
los errores API no se transforman en HTML exitoso. El prefijo compilado se guarda
en `rhodiz-web.json` y debe coincidir con la ruta de `PUBLIC_API_URL` al arrancar.

Sin `EXPO_PUBLIC_WEB_BASE_PATH`, desarrollo y clientes móviles conservan sus
valores anteriores. `EXPO_PUBLIC_API_URL` sigue siendo un override explícito.
No se cambia la identidad, el modelo residente ni el diseño del frontend RHODIZ.

## Construcción e instalación

`Dockerfile` fija Node 24.21.0 bookworm-slim por digest y pnpm 11.19.0. Instala tanto
las dependencias de build como las de producción con `--frozen-lockfile`.
El contexto permite solo entradas de build; excluye `.env*`, `.npmrc`, `.git`,
datos, pruebas, caches y evidencias. No utiliza secretos como argumentos de build.

Para generar los artefactos de aplicación en un entorno de desarrollo aislado:

```sh
pnpm install --frozen-lockfile
pnpm build:server
EXPO_NO_DOTENV=1 EXPO_PUBLIC_WEB_BASE_PATH=/muse pnpm build:web:rhodiz
```

La imagen ejecuta únicamente `node dist/apps/server/src/index.js`, como UID 1000.
No incluye el browser worker como servicio. El filesystem de la receta de Compose
es de solo lectura; `/data` persiste el estado local auxiliar y `/tmp` es efímero.
La receta publica únicamente `127.0.0.1:28787` para el nginx canónico de RHODIZ;
nunca enlaza OpenMuse a una interfaz pública ni monta Docker socket. El límite de
memoria es configurable y todavía necesita validación de capacidad en el stack
instalado.

`infra/compose.rhodiz.yaml` es una entrada para la orquestación de entrega, no una
orden de aplicar cambios en producción. Requiere una imagen aprobada por digest,
la red existente autorizada, URLs canónicas y el archivo de secreto aprobado.
El paso productivo pertenece al procedimiento RHODIZ `scripts/docker-update.sh`
después de todas las puertas de calidad y del baseline de recuperación.

## Clave de cifrado y estado

El runtime acepta `TOKEN_ENCRYPTION_KEY_FILE`, con una clave base64 canónica de
32 bytes. La lectura falla ante archivo ausente, vacío, no regular, demasiado grande
o configuración simultánea mediante `TOKEN_ENCRYPTION_KEY`. No imprime el valor.

El archivo debe ser aprovisionado por el mecanismo autorizado y ser legible por
UID 1000. Compose con secreto basado en archivo no convierte automáticamente su
propietario: no corregir esto cambiando permisos de secretos existentes. Mantener
la misma clave y el volumen de datos entre reinicios; no regenerarlos como fallback.
La memoria de usuario sigue siendo canónica en MemoryOS, no en ese volumen auxiliar.

La web exportada y el directorio de datos no pueden solaparse. Los dotfiles y los
source maps no se sirven como assets públicos. Un healthcheck solo verifica el
proceso/configuración; no demuestra un turno Hermes, una operación MemoryOS ni
una acción gobernada contra los servicios instalados.

## Puertas todavía necesarias para liberar

Antes de publicar/promover se necesita panel RHODIZ independiente sobre el diff
completo, test-automator, validación nativa final y CI del SHA exacto. Además:
construir y examinar la imagen, probar usuario no root/filesystem/secretos,
SIGTERM con streams, reinicio y persistencia, gateway real y E2E autenticado.
No trasladar PASS de otros worktrees o revisiones a este candidato.

La recuperación debe partir de la release **realmente instalada**, incluidos
imagen/digest, configuración y estado autorizados, con rollback probado. Un
checkout de main o revert de código no sustituye ese baseline. No desplegar
mientras falte, ni reintentar por otro canal una operación bloqueada por permisos.

## Referencias primarias de implementación

- Expo SDK 54, `experiments.baseUrl`: https://docs.expo.dev/versions/v54.0.0/config/app/#baseurl
- Hono Node adapter y static files: https://hono.dev/docs/getting-started/nodejs#serve-static-files
- Node LTS: https://nodejs.org/en/about/previous-releases
- Metadatos de la imagen fijada: https://hub.docker.com/v2/repositories/library/node/tags/24.21.0-bookworm-slim
