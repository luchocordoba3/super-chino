# Lumina · Vidriería

Web + software de gestión para vidrierías (atraer, vender, hacer la obra, la plata y la postventa). Multi-cliente: cada vidriería tiene su cuenta, su panel y su página pública. Primer cliente: **Cristales Ariel** (Villa Ballester).

Proyecto independiente: vive en `vidrieria/` dentro de este repo, pero se puede mover tal cual al repo de Lumina.

## Qué hace

**Web pública de cada vidriería** (`/cristales-ariel`, o su dominio propio)
- Portada, servicios, trabajos hechos, cómo trabajan, zonas y preguntas frecuentes. Colores y textos editables desde el panel.
- Formulario "Pedí tu presupuesto": tipo de trabajo, medidas aproximadas, hasta 3 fotos, zona, nombre y WhatsApp. No muestra precios.
- La consulta llega al panel, y el visitante puede avisar por WhatsApp con un toque.
- Botón flotante de WhatsApp. Título y vista previa listos para Google y WhatsApp.

**Panel del dueño** (`/panel`, en la PC o el celular; en el celular, con barra de accesos abajo y botón **Medir**)
- **Inicio:**
  - consultas nuevas, presupuestos para seguir hoy, aceptados del mes, señas cobradas y **ganancia del mes**;
  - **señas para confirmar**, con el comprobante que subió el cliente;
  - **"Subió el dólar":** presupuestos enviados que hoy quedaron baratos. Con un toque se pasan al dólar de hoy y se reenvían por WhatsApp;
  - trabajos aceptados sin pedir material.
- **Avisos al celular** (notificación push): consulta nueva, el cliente está mirando el presupuesto (y cuántas veces lo abrió), aceptó, mandó la seña. Se activan en cada celular desde Inicio o Ajustes; en iPhone, primero "Agregar a inicio".
- **Medir en obra** (`/panel/medir`):
  - se dicta o se escribe "mampara 1,20 por 1,80 templado 8";
  - fotos y nota por pieza;
  - arma el presupuesto ahí mismo;
  - **funciona sin señal**: queda guardada en el celular y se sube sola cuando vuelve.
- **Consultas:** las que llegan desde la web, con fotos. "Presupuestar" arma el presupuesto con los datos ya cargados.
- **Presupuestador:**
  - eligís una plantilla (mampara, box, espejo, cambio de vidrio, baranda, DVH), ponés ancho × alto y cantidad, y calcula al instante;
  - m² con desperdicio, cantos por metro lineal, herrajes, colocación, flete por km, urgencia, ajuste por tipo de cliente, descuento, seña y saldo;
  - los precios en dólares se pasan a pesos con el dólar del día (oficial o blue, de dolarapi.com) o el que cargues a mano. El dólar queda congelado en cada presupuesto.
  - todo se puede tocar a mano: cantidades, precios y líneas;
  - **opciones** (hasta 3, ej. "Templado 8 mm" y "Templado 10 mm"): el cliente las ve una al lado de la otra y acepta la que elige;
  - **ganancia estimada** de cada presupuesto con el costo cargado en Precios (el cliente no la ve);
  - **pegar mensaje:** pegás el WhatsApp del cliente ("2 vidrios de 50x70 de 4mm y un espejo de 1x1.5") y arma los trabajos;
  - dibujo a escala de cada pieza con sus medidas.
- **Enviar:** link propio (`/p/…`) por WhatsApp con el mensaje armado. El cliente ve el detalle con el dibujo de cada pieza, sin precios unitarios, lo guarda en PDF y lo acepta con un toque. Al aceptar ve el alias o CBU para la seña y sube el comprobante (foto o PDF); el dueño confirma el cobro. El panel muestra cuántas veces lo abrió.
- **Seguimiento:** enviados hace 2 días o más sin respuesta, con el mensaje de seguimiento listo.
- **Precios:**
  - catálogo en pesos o dólares;
  - suba o baja por %;
  - importar la lista del proveedor desde Excel o CSV, que adivina columnas, categoría, unidad, moneda y espesor;
  - plantillas de trabajo editables.
- **Compras** (en **Materiales**, junto con Precios, Retazos y Stock): junta el material de los trabajos aceptados (vidrios cortados a medida con cada pieza, herrajes sumados) y arma el pedido al proveedor por WhatsApp. Al marcarlos como pedidos, los trabajos pasan a "Pedido al proveedor".
- **Mi web:** textos, colores, logo, fotos de trabajos, servicios y preguntas.
- **Ajustes:** dólar y % de alerta, desperdicio, seña, urgencia, flete, validez, redondeo de medidas, mínimo por pieza, IVA, ajuste por tipo de cliente, datos para cobrar la seña, proveedor, avisos y usuarios (dueño y socio).

**Hacer (la obra)**
- **Trabajos** (`/panel/trabajos`): cada presupuesto aceptado es un trabajo, con tablero por estado (por pedir, pedido, en fabricación, listo para colocar, agendado, colocado, cerrado), fecha prometida según el plazo del proveedor y aviso cuando se atrasa. Agenda semanal por equipo, equipos con jornal y roturas.
- **Ficha del colocador** (`/o/…`, sin login): dirección con Maps, WhatsApp del cliente, piezas con dibujo y peso ("necesita 2 personas"), checklist, "Llegamos", fotos de antes y después y "Terminado" (avisa al dueño).
- **Garantía con QR** (`/g/…`): fecha, vidrio, colocador y vencimiento; etiqueta para imprimir y pegar en el trabajo.
- **Retazos** (el editor avisa "tenés un retazo que sirve") y **stock** de herrajes con mínimo (se descuenta al colocar).

**Plata**
- **Caja** (`/panel/caja`): cobros por medio de pago con su comisión, por cobrar (cuentas corrientes), gastos fijos y de obra, jornales con liquidación semanal, cheques y echeqs, facturas.
- **Mercado Pago** (opcional, con el token de la vidriería guardado cifrado): botón de pago en el presupuesto; el pago se registra solo.
- **Factura C directo con ARCA** (WSAA + WSFEv1, sin proveedor pago): certificado y clave de cada vidriería, cifrados; homologación o producción. También se cargan facturas hechas por fuera.
- **Números** (`/panel/numeros`): monotributo contra el tope de la categoría, caja del mes, próximos 30 días, punto de equilibrio, tasa de cierre por origen y tipo de trabajo, prueba de precio, margen por tipo de trabajo y ganancia real de cada trabajo.

**Vender (además del presupuestador)**
- Aviso de **vidrio de seguridad** (IRAM 12595) con conformidad del cliente, **cuotas** con recargo, origen de cada consulta (web, Google, cartel, recomendación…), **edificios** de consorcios con sus vidrios y **formato para la aseguradora**.
- **Foto con IA "Así quedaría"**: desde la foto del cliente arma la imagen con el trabajo puesto y la suma al link del presupuesto. Se activa con `IMAGE_API_KEY` (Gemini); sin clave muestra "Se activa pronto". Cupo por mes según el plan.

**Atraer y postventa**
- **Marketing** (`/panel/marketing`): de dónde llegan los clientes, guía de Google y QR de reseñas, carteles de obra con QR (escaneos y consultas), links de recomendación con beneficio, modo tormenta (cartel de urgencias en la web por 48 horas y clientes por barrio) y fotos de antes y después con el texto para redes.
- **Web:** una página por servicio (`/cristales-ariel/servicios/…`) con sus fotos y el formulario ya elegido; galería con tipo de trabajo y barrio; el presupuesto muestra trabajos parecidos.
- **"Para mandar hoy"** en Inicio: confirmar turnos de mañana, pedir reseña, control a los 30 días, service a los 6 y 12 meses, avisar demoras, pedir material y reponer stock. Cada uno con su mensaje de WhatsApp.

Todo sale por links de WhatsApp (`wa.me`), sin la API paga.

Cada vidriería nueva arranca con catálogo y plantillas **de ejemplo** (precios orientativos) para reemplazar por los suyos.

## Planes

Definidos en `packages/shared/src/plans.ts` (la API y el panel los respetan; lo que no incluye se ve con candado).

| Plan | Alta (pago único) | Abono | Fotos con IA por mes |
| --- | --- | --- | --- |
| Inicial · Presupuestá y vendé | US$ 300 | US$ 35 | 10 |
| Profesional · Organizá la obra | US$ 800 | US$ 65 | 40 |
| Completo · Controlá la plata | US$ 1.800 | US$ 99 | 100 |

El plan de cada vidriería se cambia en **Lumina** (`/panel/lumina`), que solo ven los emails de `LUMINA_ADMINS` (por defecto, lucianocordoba3@gmail.com).

**Oferta para otras vidrierías:** https://lumina-vidrieria.onrender.com/oferta (5 hojas A4; Ctrl + P → Guardar como PDF). Con `/oferta?editar=1` aparece el recuadro para escribir la frase de Ariel antes de imprimir. El HTML está en `apps/web/public/oferta.html` y las capturas en `apps/web/public/oferta/`.

## Cómo levantarlo

Requisitos: Node 22, pnpm y PostgreSQL 16. Si no tenés Postgres: `docker compose up -d`.

```bash
cd vidrieria
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm db:migrate        # crea las tablas
pnpm db:seed           # demo de Cristales Ariel (con --reset la recrea)
pnpm dev               # API en :3000 y web en http://localhost:5173
```

| Quién | Cómo entra |
| --- | --- |
| Ariel (dueño) | `ariel@demo.com` / `demo1234` |
| Socio | `socio@demo.com` / `demo1234` |

Web de ejemplo: http://localhost:5173/cristales-ariel

Las imágenes de la demo son ilustrativas, generadas con Higgsfield, y se cargan desde su CDN. Cuando Ariel mande fotos reales, se suben desde **Mi web**.

## Pruebas

```bash
pnpm test        # motor de presupuestos, lectura de listas y API (base vidrieria_test)
pnpm typecheck
pnpm e2e         # Playwright de punta a punta (base vidrieria_e2e): consulta → presupuesto → el cliente acepta
```

## Publicar en Render

Publicada en https://lumina-vidrieria.onrender.com (web de ejemplo: `/cristales-ariel`, panel: `/login`). Comparte la base de Super Chino en el schema `vidrieria`.

Mientras esté dentro de `super-chino` (se hace desde el celular, en unos 10 minutos):

1. **New → Postgres**: nombre `vidrieria-db`, región Virginia, plan Free. Cuando esté lista, copiá la **Internal Database URL**.
2. **New → Web Service** → repo `super-chino`, Branch `claude/sleepy-dirac-y0lt89`, **Root Directory** `vidrieria`, Language Docker, región Virginia (la misma que la base), plan Free.
3. **Environment Variables**: `DATABASE_URL` = la URL del paso 1 y `SEED_DEMO` = `true` (carga la demo de Cristales Ariel). `JWT_SECRET` es opcional: si no está, se deriva de `DATABASE_URL`. Las claves de los avisos (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`) también son opcionales: si no están, se derivan del secreto.

Variables opcionales: `IMAGE_API_KEY` (foto con IA), `LUMINA_ADMINS` (emails que ven el admin de Lumina, separados por coma) y `PUBLIC_URL` (si no está, usa la de Render).

Cuando la demo cambia (`DEMO_VERSION` en `prisma/seed.ts`), al publicar se vuelve a crear sola. Solo toca la cuenta de demo (`ariel@demo.com`), nunca una cuenta real.

Cuando se mude al repo de Lumina, `render.yaml` crea las dos cosas sola (**New → Blueprint**).

**Dominio propio:** en Render, Settings → Custom Domains, agregás el dominio (ej. `cristalesariel.com.ar`). En el panel de la vidriería, Ajustes → Dominio propio, escribís el mismo dominio: al entrar por ahí se ve directo su web.

## Estructura

```
apps/api         Fastify + Prisma (PostgreSQL). Rutas en src/routes, servicios en src/services
apps/web         React + Vite. Panel en src/pages, web pública en src/site
packages/shared  Motor de presupuestos (calcQuote), teléfonos para WhatsApp y esquemas compartidos
cuestionario/    Cuestionario para relevar a cada vidriería nueva
docs/            Respuestas de cada cliente
```

## Falta probar afuera de este entorno

- Avisos push en celulares reales.
- Mercado Pago con una cuenta real (token de la vidriería).
- ARCA en homologación: hace falta el certificado de la vidriería, que lo saca su contador.
- Foto con IA con una clave real (`IMAGE_API_KEY`).
- El modo tormenta se activa a mano; el aviso automático del Servicio Meteorológico no está hecho (su API no se pudo verificar).
