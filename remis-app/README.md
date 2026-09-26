# 🚕 Mi Remis

App para el chofer de remis. Lleva la cuenta de los km, avisa cuándo toca el service, anota combustible, peajes y gastos, y muestra lo que ganás de verdad.

Es una app web que se instala en el celular (PWA). Funciona **sin internet** y los datos quedan **guardados en el teléfono**: no hay servidor, no hay usuario y no cuesta nada mantenerla.

## Qué hace

- **Turnos y km por día:** tocás "Empezar turno" y "Terminar turno" con el km del odómetro. La app calcula los km del día, las horas y tu ritmo (km por día).
- **Auto compartido (chofer de día y de noche):**
  - al recibir y al entregar el auto anotás el nivel de combustible, fotos y detalles;
  - la app separa **tus km** de los **del otro chofer**;
  - si dividen el service por km, calcula cuánto le toca a cada uno.
- **Mantenimiento con avisos por km y por fecha:**
  - trae cargado el plan típico: aceite, filtros, correa de distribución, bujías, cubiertas, frenos, líquidos, batería y equipo de GNC;
  - cuando registrás un service el plan se actualiza solo;
  - te dice cuántos km faltan y, a tu ritmo, en cuántos días.
- **Combustible (nafta, GNC y gasoil):**
  - calcula el rendimiento (km/l o km/m³) entre dos cargas con tanque lleno, sin mezclar los km del otro chofer;
  - te avisa si el consumo sube de golpe.
- **Peajes y gastos:**
  - peajes favoritos que se anotan con un solo toque;
  - gastos por rubro (lavado, taller, seguro, patente, multas, comida, celular…) con foto del comprobante.
- **Ingresos y ganancia real:**
  - lo recaudado, los viajes, las propinas y lo que es efectivo;
  - la agencia puede ser base fija (con el botón "Pagué la base") o porcentaje;
  - muestra la ganancia por día, semana y mes, por km y por hora, y el costo por km.
- **Vencimientos de papeles:**
  - VTV/RTO, seguro, oblea y prueba hidráulica de GNC, licencia profesional, habilitación del remis, matafuego y patente;
  - avisa 30 días antes;
  - con un botón los agregás al calendario del celular (Google Calendar o archivo `.ics`) para que te avise aunque no abras la app.
- **Checklist antes de salir:** aceite, agua, cubiertas, luces, frenos, matafuego y más. Lo que da mal queda como aviso hasta que lo arreglás.
- **Siniestros:**
  - una guía de qué hacer si chocás;
  - un formulario con fotos, ubicación, datos del otro auto, testigos y número de denuncia;
  - un aviso si no hiciste la denuncia al seguro (hay 3 días);
  - un botón para mandar todo por WhatsApp al seguro o a la agencia.
- **Resumen:** gráfico de km por día, gastos por rubro, rendimiento de combustible y exportación a Excel (CSV).
- **Copia de seguridad:** un archivo con todo (fotos incluidas) que podés mandar a tu WhatsApp o a Drive, y restaurar en otro celular.
- **Modo oscuro** para la noche, botones grandes y teclado numérico.

> Para probarla sin cargar nada: en la pantalla de bienvenida tocá **"Primero quiero verla con datos de ejemplo"**. Trae 6 semanas de un remis compartido. Después la borrás en Ajustes → Borrar todo.

## Instalarla en el celular

- **Android (Chrome):** abrí la dirección de la app y tocá el menú **⋮ → Instalar app** (o "Agregar a la pantalla principal").
- **iPhone (Safari):** tocá **Compartir → Agregar a inicio**. En iPhone conviene instalarla, porque Safari puede borrar los datos de las páginas que no se usan por una semana. Instalada eso no pasa.

**Importante:** como los datos viven en el celular, hacé una copia seguido (Ajustes → Copia de seguridad → Compartir). La app te lo recuerda si pasan más de 7 días.

## Para programadores

Requisitos: Node 22 y pnpm.

```bash
pnpm install
pnpm dev          # http://localhost:5174
pnpm test         # cálculos, base de datos y copia de seguridad (Vitest)
pnpm typecheck
pnpm e2e          # compila y recorre la app en Chromium (Playwright)
pnpm icons        # regenera los PNG de los íconos desde public/icon.svg
```

- **Tecnología:** React 19, Vite, TypeScript, `vite-plugin-pwa`, y Dexie para guardar en IndexedDB. Es el mismo estilo que Super Chino, pero sin servidor.
- **Estructura:**
  - `src/domain/`: todos los cálculos, sin pantallas y con pruebas (km, mantenimiento, papeles, combustible, plata, avisos);
  - `src/db/`: la base del celular, la copia de seguridad y los datos de ejemplo;
  - `src/pages/` y `src/components/`: las pantallas.

## Publicarla en Render (gratis)

Es un sitio estático, así que no necesita base de datos ni se duerme.

1. En [render.com](https://render.com) andá a **New → Static Site** y elegí este repositorio.
2. Completá así:
   - **Root Directory:** `remis-app`
   - **Build Command:** `npm i -g pnpm@10.33.0 && pnpm install --frozen-lockfile && pnpm build`
   - **Publish Directory:** `dist`
3. En **Redirects/Rewrites** agregá la regla Source `/*`, Destination `/index.html`, Action **Rewrite**.
4. Abrí la dirección que te da Render desde el celular e instalala.

Si más adelante la pasás a su propio repositorio, el `render.yaml` de esta carpeta arma todo solo (New → Blueprint).

## Ideas para más adelante

- **Km automáticos por GPS:** necesita una app nativa (Capacitor), porque una web no puede seguirte con la pantalla apagada.
- **Varios choferes o la agencia entera,** con usuarios y los datos en un servidor, como Super Chino.
- **Leer el ticket de la carga con una foto (IA),** para no tipear litros y montos.
- **Copia automática en la nube** y el mismo usuario en varios celulares.
