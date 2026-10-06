# Lumina · Vidriería

Web + presupuestador para vidrierías. Multi-cliente: cada vidriería tiene su cuenta, su panel y su página pública. Primer cliente: **Cristales Ariel** (Villa Ballester).

Proyecto independiente: vive en `vidrieria/` dentro de este repo, pero se puede mover tal cual al repo de Lumina.

## Qué hace

**Web pública de cada vidriería** (`/cristales-ariel`, o su dominio propio)
- Portada, servicios, trabajos hechos, cómo trabajan, zonas y preguntas frecuentes. Colores y textos editables desde el panel.
- Formulario "Pedí tu presupuesto": tipo de trabajo, medidas aproximadas, hasta 3 fotos, zona, nombre y WhatsApp. No muestra precios.
- La consulta llega al panel, y el visitante puede avisar por WhatsApp con un toque.
- Botón flotante de WhatsApp. Título y vista previa listos para Google y WhatsApp.

**Panel del dueño** (`/panel`, en la PC o el celular)
- **Inicio:** consultas nuevas, presupuestos para seguir hoy, presupuestado y aceptado de la semana.
- **Consultas:** las que llegan desde la web, con fotos. "Presupuestar" arma el presupuesto con los datos ya cargados.
- **Presupuestador:**
  - eligís una plantilla (mampara, box, espejo, cambio de vidrio, baranda, DVH), ponés ancho × alto y cantidad, y calcula al instante;
  - m² con desperdicio, cantos por metro lineal, herrajes, colocación, flete por km, urgencia, ajuste por tipo de cliente, descuento, seña y saldo;
  - los precios en dólares se pasan a pesos con el dólar del día (oficial o blue, de dolarapi.com) o el que cargues a mano. El dólar queda congelado en cada presupuesto.
  - todo se puede tocar a mano: cantidades, precios y líneas.
- **Enviar:** link propio (`/p/…`) por WhatsApp con el mensaje armado. El cliente ve el detalle sin precios unitarios, lo guarda en PDF y lo acepta con un toque. El panel muestra si lo abrió.
- **Seguimiento:** enviados hace 2 días o más sin respuesta, con el mensaje de seguimiento listo.
- **Precios:**
  - catálogo en pesos o dólares;
  - suba o baja por %;
  - importar la lista del proveedor desde Excel o CSV, que adivina columnas, categoría, unidad, moneda y espesor;
  - plantillas de trabajo editables.
- **Mi web:** textos, colores, logo, fotos de trabajos, servicios y preguntas.
- **Ajustes:** dólar, desperdicio, seña, urgencia, flete, validez, redondeo de medidas, mínimo por pieza, IVA, ajuste por tipo de cliente, y usuarios (dueño y socio).

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

Mientras esté dentro de `super-chino`:

1. **New → PostgreSQL** (plan Free) y copiá la *Internal Database URL*.
2. **New → Web Service**, elegí el repo y la branch, **Root Directory** `vidrieria` y **Language** Docker.
3. Variables: `DATABASE_URL` (la del paso 1), `JWT_SECRET` (cualquier texto largo) y `SEED_DEMO=true` para cargar la demo.

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
- Stock de perfiles, herrajes y retazos, y optimización del corte de planchas.
- Caja, cobros, señas, cuentas corrientes, gastos fijos y ganancia por trabajo y por mes.
- Factura ARCA.
