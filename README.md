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
  - apertura y cierre de caja con arqueo;
  - pagos a proveedores, gastos, retiros del dueño e ingresos de cambio desde la caja: quedan anotados y el cierre los descuenta.
- **Sin internet:** la caja guarda catálogo, precios, ofertas y cajeros en la PC. Las ventas quedan en una cola y se sincronizan solas cuando vuelve la conexión (sin duplicar nada).
- **Precios:**
  - edición individual con historial de quién cambió qué;
  - suba o baja masiva por %, con vista previa y redondeo;
  - sugerencia de nuevo precio cuando sube el costo (protección de margen).
- **Empleados:**
  - ficha de cada uno (DNI, teléfono, fecha de ingreso y sueldo), que solo ve el dueño;
  - horario semanal;
  - fichaje de entrada y salida en la caja con PIN (anda sin internet) o desde el celular;
  - horas por día, semana o mes con tardanzas, faltas y fichajes incompletos, para bajar a Excel y pagar sueldos;
  - aviso al celular del dueño si alguien llega tarde o no viene;
  - el dueño corrige o carga fichajes a mano.
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

## 📱 Celu Control (casa de celulares)

Es el mismo código con otro "sabor": otro nombre, color y menú, y módulos propios para un local que vende celulares nuevos y usados, accesorios, hace servicio técnico y vende por WhatsApp/Instagram con entregas. Los precios de los equipos son en dólares. Cada local tiene un rubro (`Store.businessType`): un local de celulares ve estas pantallas, uno de supermercado ve las de siempre. Está solo en español.

- **Dólar:**
  - toma la cotización de [dolarapi.com](https://dolarapi.com) cada 15 minutos y, si falla, la de bluelytics;
  - el dueño elige blue, oficial, MEP o tarjeta (compra o venta), le suma un ajuste o pone una cotización propia;
  - cada venta guarda el dólar que se usó;
  - los precios se muestran en dólares y en pesos.
- **Equipos con IMEI:**
  - cada celular es una ficha con IMEI (se valida el dígito verificador), estado (nuevo, usado o reacondicionado), grado A/B/C, batería, color, si la cuenta iCloud/Google está libre, fotos, costo y garantía del proveedor;
  - estados: disponible, señado, en reparación, vendido, garantía con proveedor o baja, con la historia completa;
  - ingreso escaneando o pegando la columna de IMEI de Excel;
  - consulta de garantía por IMEI y etiqueta con precio para imprimir.
- **Caja (anda sin internet):**
  - se escanea el IMEI de la caja y el sistema sabe qué equipo es;
  - pago mixto en pesos, dólares, débito, crédito en cuotas (con el recargo de cada plan), QR, transferencia, crédito de un usado tomado o una seña;
  - vuelto en pesos o en dólares;
  - cajón de pesos y cajón de dólares, con arqueo de los dos al cerrar;
  - ticket con certificado de garantía (6 meses nuevos y 3 usados como mínimo, Ley 24.240);
  - además se cobran reparaciones, se toman señas, se le paga a quien nos vendió un usado y se recibe la rendición de los cadetes.
- **Usados (toma y compra):**
  - checklist del equipo y fotos del DNI;
  - consulta en [ENACOM](https://www.enacom.gob.ar/imei) con captura obligatoria (un IMEI denunciado no se puede tomar);
  - iCloud/Google cerrado y firma de la declaración en la pantalla;
  - grilla de precios por modelo y grado;
  - el equipo entra al stock como usado con costo igual a lo que se pagó;
  - **libro de compras de usados** en Excel para inspecciones (CABA Ley 6.009 y similares).
- **Servicio técnico:**
  - orden con checklist de ingreso, fotos, código o patrón de desbloqueo cifrado (lo ven solo el técnico y el dueño), técnico y fecha prometida;
  - presupuesto con repuestos del stock y mano de obra;
  - **link para que el cliente siga su reparación y apruebe o rechace el presupuesto desde el celular**;
  - mensajes de WhatsApp ya escritos;
  - comprobante para imprimir;
  - reingreso por garantía sin cargo;
  - avisos de órdenes trabadas o sin retirar.
- **Pedidos y entregas:**
  - pedidos de WhatsApp/Instagram con el equipo (IMEI) reservado;
  - envío o retiro, pago previo o contra entrega en pesos o dólares;
  - pantalla del cadete en el celular: mapa, llamar, WhatsApp, "entregado" con foto, DNI de quien recibe e IMEI confirmado;
  - rendición en la caja con aviso si falta plata;
  - devolución por arrepentimiento dentro de los 10 días.
- **Clientes:** ficha con compras, equipos, garantías vigentes, reparaciones, usados, pedidos y señas.
- **Números:**
  - ganancia por equipo en dólares;
  - stock valorizado y antigüedad (0–30, 31–60, 61–90 y más de 90 días);
  - modelos más vendidos, vendedores con comisión, medios de pago y canales;
  - técnicos, usados revendidos, cadetes y cierres de caja por moneda;
  - todo se baja a Excel.
- **Postventa:** tareas automáticas para escribirle por WhatsApp al cliente a los 3 y a los 30 días, y para ofrecerle cambiar el equipo al año.

Para probarlo en la PC:

```bash
APP_FLAVOR=celulares pnpm db:seed                      # local de demostración DEMO02
APP_FLAVOR=celulares pnpm --filter @super-chino/api dev
VITE_FLAVOR=celulares pnpm --filter @super-chino/web dev
```

| Quién | Cómo entra |
| --- | --- |
| Dueño | `celus@demo.com` / `demo1234` (PIN de caja `0000`) |
| Flor (vende, toma usados y pedidos) | local `DEMO02`, usuario `vendedor`, PIN `1234` |
| Leo (técnico) | local `DEMO02`, usuario `tecnico`, PIN `2345` |
| Tomi (cadete) | local `DEMO02`, usuario `cadete`, PIN `3456` |

En Render, `render.yaml` crea también el servicio **celu-control** con su propio link. Para un negocio real conviene que tenga su propia base de datos: hay que cambiar su `DATABASE_URL`.

Queda para más adelante: factura electrónica ARCA, WhatsApp Business API, MercadoLibre/Tiendanube y consultas pagas de IMEI.

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
                 # tareas con foto, conteo, ofertas, un recorrido de todas las pantallas buscando errores
                 # y la casa de celulares (caja con IMEI y dólares, servicio técnico, pedido con cadete)
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
- Fiado / cuenta corriente, predicción de ventas según clima y feriados
