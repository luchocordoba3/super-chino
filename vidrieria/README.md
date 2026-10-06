# Lumina · Vidriería

Web + presupuestador para vidrierías. Multi-cliente: cada vidriería tiene su cuenta, su panel y su página pública. Primer cliente: **Cristales Ariel** (Villa Ballester).

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
- **Compras:** junta el material de los trabajos aceptados (vidrios cortados a medida con cada pieza, herrajes sumados) y arma el pedido al proveedor por WhatsApp. Después se marcan como comprados.
- **Mi web:** textos, colores, logo, fotos de trabajos, servicios y preguntas.
- **Ajustes:** dólar y % de alerta, desperdicio, seña, urgencia, flete, validez, redondeo de medidas, mínimo por pieza, IVA, ajuste por tipo de cliente, datos para cobrar la seña, proveedor, avisos y usuarios (dueño y socio).

Cada vidriería nueva arranca con catálogo y plantillas **de ejemplo** (precios orientativos) para reemplazar por los suyos.

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

## Próxima etapa

- Trabajos y agenda de mediciones e instalaciones por equipo, con órdenes de trabajo para los colocadores en el celular.
- Jornales de colocadores.
- Compras al proveedor por WhatsApp.
- Stock de perfiles, herrajes y **retazos**: que el presupuestador avise "tenés un retazo de 8 mm que sirve", y optimización del corte de planchas.
- Ficha de obra para el colocador (dirección, dibujo, materiales y checklist); la foto del trabajo terminado pasa a la web y se le pide reseña de Google al cliente.
- Leer el mensaje del cliente con IA (hoy son reglas simples).
- Caja, cobros, señas, cuentas corrientes, gastos fijos y ganancia por trabajo y por mes.
- Factura ARCA.
