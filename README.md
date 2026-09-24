# 🛒 Super Chino

Software para supermercados: caja que funciona sin internet, stock por lote con vencimientos, equipo con usuario propio e indicaciones del dueño traducidas entre chino y español.

Es una app web instalable (PWA): la misma app corre en la PC de la caja (con lector de códigos USB) y en el celular del dueño y los empleados. Más adelante se puede publicar en Play Store / App Store con Capacitor sin reescribirla.

## Qué hace

**Base**
- **Usuarios:** el dueño entra con email y contraseña; cada empleado con código de local + usuario + PIN. El dueño elige los permisos de cada empleado: vender, cargar stock, cambiar precios, ajustes/mermas y ver ventas.
- **Carga rápida de stock:** escaneás el código; si el producto es nuevo ponés nombre y precio; después cantidad y, si querés, vencimiento. La caja ya lo reconoce. El nombre se autocompleta con Open Food Facts.
- **Stock por lote:** cada ingreso crea un lote con vencimiento opcional. Al vender se descuenta primero el lote que vence antes (FEFO).
- **Caja:**
  - lector USB, cantidad con `3*`, productos por kilo;
  - efectivo, débito, crédito, QR y transferencia, con pago mixto y vuelto;
  - ticket interno;
  - apertura y cierre de caja con arqueo.
- **Sin internet:** la caja guarda catálogo, precios, ofertas y cajeros en la PC. Las ventas quedan en una cola y se sincronizan solas cuando vuelve la conexión (sin duplicar nada).
- **Precios:**
  - edición individual con historial de quién cambió qué;
  - suba o baja masiva por %, con vista previa y redondeo;
  - sugerencia de nuevo precio cuando sube el costo (protección de margen).
- **Indicaciones del dueño:** mensajes y tareas para todo el equipo o para una persona, con confirmación de lectura, foto de prueba y notificaciones push.

**Ideas nuevas**
- **Chino ↔ español:** toda la app está en los dos idiomas. Los mensajes se traducen con IA al idioma de cada uno, con opción de ver el original.
- **Stock con una foto (IA):** de una foto de factura o remito se leen los renglones, que se relacionan con el catálogo, se revisan y se guardan. Con una foto de la etiqueta se leen lote y vencimiento.
- **Ofertas antes de que venza:**
  - si un lote no se va a vender a tiempo, la app sugiere un descuento escalonado;
  - el dueño lo aprueba con un toque y la caja lo aplica sola hasta agotar ese lote;
  - hay un cartel "Ofertas del día" para imprimir o mandar por WhatsApp.
- **Control anti-pérdidas:**
  - avisos por productos borrados o ventas anuladas, por diferencias de caja y por stock negativo;
  - **conteo sorpresa a ciegas** todos los días;
  - sugerencia de qué reponer, con el pedido al proveedor listo para mandar por WhatsApp.
- **Panel del dueño:** ventas del día, ganancia real (con el costo de cada lote), cajeros, medios de pago, mermas y plata salvada del vencimiento. Todos los días a las 21 hs le llega un resumen al celular.

## Cómo levantarlo

Requisitos: Node 22, pnpm y PostgreSQL 16. Si no tenés Postgres instalado: `docker compose up -d`.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # revisar DATABASE_URL y JWT_SECRET
pnpm db:migrate                           # crea las tablas
pnpm db:seed                              # datos de demostración (opcional)
pnpm dev                                  # API en :3000 y web en http://localhost:5173
```

Usuarios de la demo:

| Quién | Cómo entra |
| --- | --- |
| Dueño (usa la app en chino) | `dueno@demo.com` / `demo1234` (PIN de caja `0000`) |
| Sofía (vende y carga stock) | local `DEMO01`, usuario `sofia`, PIN `1234` |
| Martín (vende) | local `DEMO01`, usuario `martin`, PIN `5678` |

Para usar la caja, entrá como dueño en la PC y abrí **Caja** → "Vincular esta PC como caja". Desde ese momento la caja funciona aunque se corte internet.

## Configuración (`apps/api/.env`)

| Variable | Para qué |
| --- | --- |
| `DATABASE_URL` | Base de datos PostgreSQL |
| `JWT_SECRET` | Secreto de las sesiones (obligatorio en producción) |
| `ANTHROPIC_API_KEY` | Opcional. Activa la traducción y la lectura de fotos. Sin esta clave la app funciona igual. |
| `AI_MODEL` | Modelo de IA (por defecto `claude-opus-5`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Opcional. Notificaciones push; se generan con `npx web-push generate-vapid-keys` |
| `UPLOAD_DIR` | Carpeta de fotos (tareas y facturas) |

**Costo de la IA:** se paga por uso a Anthropic. Con el modelo por defecto, un mensaje traducido sale menos de US$0,01 y una foto de factura entre US$0,05 y 0,07. Un súper con 30 mensajes y 2 facturas por día gasta unos US$8 por mes. Cada local tiene un límite diario de fotos (configurable) y el consumo queda registrado por local (`GET /api/ai/usage`).

## Pruebas

```bash
pnpm test        # API (contra la base superchino_test) + lógica de la caja
pnpm e2e         # de punta a punta con Playwright (base superchino_e2e, se crea sola): caja, stock,
                 # tareas con foto, conteo, ofertas y un recorrido de todas las pantallas buscando errores
pnpm typecheck
```

## Publicar gratis en Render (link para probar y mostrar)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/luchocordoba3/super-chino)

1. Entrá a [render.com](https://render.com) y creá una cuenta con **GitHub**.
2. Tocá **New → Blueprint** y elegí el repo `super-chino`. Si no aparece, dale a Render acceso al repo.
3. Render lee `render.yaml` y va a crear la app y la base de datos. En **Blueprint Name** poné `super-chino` (cualquier nombre sirve). `ANTHROPIC_API_KEY` podés dejarla vacía (la app anda sin IA). Tocá **Deploy Blueprint**.
4. El primer armado tarda unos 10 minutos. Cuando termine, entrá al servicio **super-chino**: arriba aparece el link `https://super-chino-….onrender.com`. Entrá con los usuarios de la demo de arriba. Si algo falla, el detalle está en la pestaña **Logs**.

Antes de mostrarla a un cliente, entrá como dueño a **Ajustes → Reiniciar la demo con datos de hoy**: vuelve a cargar ventas, vencimientos y ofertas con fechas actuales.

Límites del plan gratis:
- **Se duerme:** si nadie la usa un rato, la primera visita tarda ~1 minuto en despertar.
- **Base temporal:** la base de datos gratis de Render vence (hoy a los 30 días).
- **Fotos:** las de tareas y facturas se pierden cuando el servicio se reinicia.

Para clientes reales conviene el plan pago de Render o pasar la base a una gratis permanente (por ejemplo Neon) cambiando `DATABASE_URL`.

## Folleto de ventas (para mandar por WhatsApp)

`docs/folleto/Super-Chino-Español.pdf` y `docs/folleto/Super-Chino-中文.pdf`: 10 páginas del tamaño de un celular con todas las funciones y el link de la demo. Para cambiar textos, editá `docs/folleto/folleto.mjs` y volvé a generarlos con `cd docs/folleto && npm install && node folleto.mjs`.

## Producción

Es un solo servicio: la API sirve la web compilada. Con Docker:

```bash
docker build -t super-chino .
docker run -p 3000:3000 -e DATABASE_URL=... -e JWT_SECRET=... super-chino
```

Hace falta HTTPS para que la caja funcione offline y para las notificaciones (service worker).

## Estructura

```
apps/api      Fastify + Prisma (PostgreSQL). Rutas en src/routes, reglas del negocio en src/domain,
              servicios (stock FEFO, ventas, avisos, revisión diaria, IA) en src/services
apps/web      React + Vite (PWA). La caja offline está en src/pos (IndexedDB + cola de sincronización)
packages/shared  Esquemas compartidos (eventos de la caja, configuración del local)
```

## Ideas para después

- Factura electrónica ARCA para los clientes que la pidan
- QR de Mercado Pago integrado en la caja
- Asistente IA para el dueño ("¿cuánto gané con bebidas esta semana?"), en chino o en español
- Varias sucursales en una sola cuenta, con traspaso de mercadería
- Balanzas con etiqueta de código de barras (fiambrería y verdulería)
- Pedidos del barrio por WhatsApp con catálogo y stock real
- Fichaje de empleados con un QR en el local
- Fiado / cuenta corriente, predicción de ventas según clima y feriados, etiquetas de góndola
