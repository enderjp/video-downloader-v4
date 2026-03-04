# Facebook Video Extractor API

API ligera en Node.js + Express que usa Puppeteer para cargar publicaciones de Facebook y exponer la URL directa del video reproducible. Util para flujos que requieren la URL del archivo para descargarlo posteriormente.

## Caracteristicas

- Endpoint REST `POST /api/extract` que recibe un JSON con la URL de la publicacion.
- Validacion de entrada con `zod` y respuestas JSON claras ante errores.
- Scraper con Puppeteer en modo headless, bloqueo opcional de recursos pesados y user-agent configurable.
- Retorna metadatos basicos (titulo, descripcion, miniatura) cuando estan disponibles.

## Requisitos

- Node.js 18+ (se recomienda 20).
- Google Chrome que instala Puppeteer automaticamente (se descarga en `node_modules`).

## Instalacion

```bash
npm install
```

## Variables de entorno opcionales

| Variable | Descripcion | Valor por defecto |
| --- | --- | --- |
| `PORT` | Puerto HTTP de Express | `3000` |
| `PUPPETEER_HEADLESS` | Modo headless para Puppeteer (`true`, `false`, `new`) | `"new"` |
| `PUPPETEER_TIMEOUT` | Tiempo maximo de carga de la pagina en ms | `60000` |
| `FACEBOOK_LOCALE` | Cabecera `Accept-Language` enviada a Facebook | `en-US,en;q=0.9` |
| `BLOCK_HEAVY_ASSETS` | Bloquear imagenes/medios pesados (`true`/`false`) | `true` |
| `PUPPETEER_USER_AGENT` | User-Agent enviado por el navegador automatizado | Chrome generico |
| `FACEBOOK_COOKIES_PATH` | Ruta del archivo Netscape de cookies reutilizable | `cookies-feb-2026.txt` |
| `FACEBOOK_DEBUG_SNAPSHOTS` | Guardar capturas HTML/JSON cuando no se encuentre video (`true`/`false`) | `true` |
| `FACEBOOK_DEBUG_DIR` | Carpeta donde se guardan las capturas de debug | `snapshots` |

Crea un archivo `.env` si deseas definirlos y ejecutalo con `PUPPETEER_HEADLESS=false npm run dev`, por ejemplo.

Si necesitas iniciar sesion, coloca un archivo de cookies en formato Netscape (como el generado por extensiones tipo "Get cookies.txt") dentro del proyecto y ajusta `FACEBOOK_COOKIES_PATH`. El valor por defecto `cookies-feb-2026.txt` ya esta referenciado para carga automatica.

Cuando no se logre detectar la URL, se guardaran capturas HTML (`.html`) y un resumen de candidatos (`.json`) dentro de la carpeta `snapshots/` (controlado por `FACEBOOK_DEBUG_SNAPSHOTS` y `FACEBOOK_DEBUG_DIR`). Esto facilita revisar el DOM y los candidatos interceptados para ajustar el scraper.

## Ejecucion

Modo desarrollo con reinicios automaticos:

```bash
npm run dev
```

Produccion simple:

```bash
npm start
```

Swagger UI queda disponible en `http://localhost:3000/docs`, por lo que puedes probar diferentes URLs directamente desde el navegador.

## Uso del endpoint

Solicitud:

```bash
curl -X POST http://localhost:3000/api/extract \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.facebook.com/61586313167670/videos/1353362139936615/"
  }'
```

Respuesta exitosa:

```json
{
  "requestedUrl": "https://www.facebook.com/61586313167670/videos/1353362139936615/",
  "sourceUrl": "https://video.xx.fbcdn.net/v/...",
  "metadata": {
    "title": "Titulo del video",
    "description": "Descripcion si esta disponible",
    "thumbnail": "https://scontent.xx.fbcdn.net/...",
    "permalink": "https://www.facebook.com/61586313167670/videos/1353362139936615/"
  },
  "fetchedAt": "2024-03-03T20:12:11.123Z"
}
```

En caso de error, se devuelve un JSON con `error` y `code` (`VIDEO_NOT_FOUND`, `FACEBOOK_ACCESS_ERROR`, etc.).

## Preparar el proyecto para un repositorio propio

1. Copia las variables necesarias: `cp .env.example .env` y ajusta los valores (sobre todo `FACEBOOK_COOKIES_PATH` si planeas subir un archivo distinto).
2. Inicializa Git y haz el primer commit:

  ```bash
  git init
  git add .
  git commit -m "chore: bootstrap facebook video extractor"
  ```

3. Crea tu repositorio vacio en GitHub y asocialo:

  ```bash
  git remote add origin git@github.com:TU_USUARIO/fb-video-extractor.git
  git push -u origin main
  ```

4. Si no quieres subir cookies reales, agrega el archivo a `.gitignore` y usa valores dummy en producción.

## Despliegue en Render.com

1. Haz login en [render.com](https://render.com) y elige **New → Web Service**.
2. Selecciona el repo que subiste y configura lo siguiente:
  - **Environment**: `Node`.
  - **Region**: la más cercana a tu audiencia.
  - **Build Command**: `npm install`.
  - **Start Command**: `npm start`.
  - **Node version**: Render tomará la de `package.json` (`>=20`).
3. En la sección de Environment Variables copia las que necesites (puedes usar `.env.example` como referencia). Si vas a usar cookies, sube el archivo al dashboard de Render y ajusta `FACEBOOK_COOKIES_PATH` al path final (por ejemplo `/opt/render/project/src/cookies-feb-2026.txt`).
4. Activa los logs en el dashboard para monitorear Puppeteer. Si Facebook bloquea la navegación, Render mostrará el stack trace.
5. Una vez que Render complete la construcción verás la URL pública (ej.: `https://fb-video-api.onrender.com`). Los endpoints `GET /health`, `GET /docs` y `POST /api/extract` quedan disponibles automáticamente.

## Limitaciones y notas

- Algunas publicaciones requieren sesion iniciada; sin cookies no sera posible obtener el video.
- Respeta los terminos de uso de Facebook y scrapea unicamente contenido para el que tengas permisos.
- El scraping puede romperse si Facebook cambia su HTML; ajusta `src/services/facebookScraper.js` segun sea necesario.
