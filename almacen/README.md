# 🏪 Almacén

Versión de Super Chino para **almacenes de barrio, kioscos y mini bares**. Vive en esta carpeta y no toca Super Chino (`apps/`, `packages/`).

Es la misma base (caja que funciona sin internet, stock por lote con vencimientos, empleados con fichaje, mensajes y tareas, panel del dueño, qué reponer) pensada para cobrar desde una tablet o un celular.

## Qué agrega sobre Super Chino

- **Stock en %** (menú *Stock %*): cada producto contra su 100%, con barra de color y cuántos días alcanza. El 100% es el *stock ideal* si el dueño lo carga (en la ficha del producto, en la planilla de importación o desde la misma pantalla); si no, lo que quedó después del último ingreso. Debajo del % de *Ajustes → Stock bajo* (25% por defecto) se pone en rojo y avisa.
- **Qué se vendió** (menú *Qué se vendió*): unidades de cada producto **por turno** (de la apertura al cierre de caja, con el empleado y el horario), **por día** (una columna por empleado) y **por semana** (lunes a domingo, con filtro por empleado). Abajo, la plata y los tickets de cada columna. Se baja a Excel. En el panel: "Hoy por turno" y cuántos productos están bajos.
- **Pase de turno:** al cerrar la caja se anotan las novedades para el que sigue. Le llegan al dueño y al equipo como mensaje (con notificación) y se muestran al abrir el turno siguiente, aunque no haya internet en esa caja. También quedan en *Ventas → Cajas*.
- **"Se está terminando" 📣:** desde la caja (anda sin internet) o desde la ficha del producto en el celular, el empleado avisa que queda poco. Al dueño le llega el aviso al celular y el producto entra en *Reponer* aunque los números digan que alcanza. Se cierra solo cuando se carga mercadería de ese producto.
- **Caja táctil (tablet o celular):** botones rápidos grandes por categoría para lo que no tiene código o sale todo el tiempo (se marcan con *Botón rápido en la caja* en la ficha del producto), escáner con la cámara (📷) y, en el celular, dos pestañas: *Productos* y *Cuenta*. En pantallas táctiles no se abre el teclado solo, y un lector USB o Bluetooth anda aunque el cursor no esté en el campo de búsqueda.
- **Mesas (cuentas abiertas):** en la caja, *＋ Mesa* abre la cuenta de una mesa (1 a N, según *Ajustes → Mesas del bar*) o de un nombre (barra, cliente). Con la mesa elegida, lo que se toca se anota ahí; se cobra al final con *Cobrar Mesa N* y el stock se descuenta recién al cobrar. Anda sin internet y las cuentas se ven en todas las cajas. Al cerrar la caja avisa si quedan mesas abiertas (siguen para el turno siguiente) y el panel muestra cuántas hay y cuánto suman.
- **Recetas:** en la ficha de un producto preparado (café, tostado, tragos), *🍳 Armar receta* indica qué ingredientes se descuentan por unidad vendida, con el costo y la ganancia. Al vender se descuentan los ingredientes (primero lo que vence antes), el costo real es la suma, y anular devuelve cada ingrediente. Lo usado en recetas cuenta para reponer los ingredientes. Los productos con receta no aparecen en Stock %, Reponer ni en los conteos.

**Para el cliente**
- **QR de Mercado Pago con el monto cargado:** cada mesa y el mostrador tienen un QR fijo impreso. En la caja se elige *QR* y *Cobrar con el QR de Mesa N* (o del mostrador): el cliente escanea con Mercado Pago, ve el monto y solo paga; la venta se cierra sola cuando Mercado Pago confirma. Se configura en *Ajustes → Mercado Pago*: *Conectar Mercado Pago* (si el sistema tiene `MP_CLIENT_ID`) o pegando el Access Token del local; después *Crear los QR* (pide la dirección del local) e *Imprimir los QR*. Usa la API de Orders en el modelo atendido con QR estático. Las credenciales se guardan cifradas. La confirmación llega por webhook (tópico Order, con la firma validada si hay `MP_WEBHOOK_SECRET`) y, además, la caja consulta cada 2 segundos. Sin internet no se puede cobrar con QR; el resto de los medios sigue andando.

## Cómo levantarlo

Requisitos: Node 22, pnpm y PostgreSQL 16. Desde la raíz del repo:

```bash
pnpm install
cp almacen/api/.env.example almacen/api/.env   # revisar DATABASE_URL y JWT_SECRET
pnpm almacen:db:migrate                         # crea las tablas en la base "almacen"
pnpm almacen:db:seed                            # datos de demostración (opcional)
pnpm almacen:dev                                # API en :3200 y web en http://localhost:5273
```

Corre al lado de Super Chino sin chocar: usa otros puertos, otra base de datos y su propio cliente de Prisma (`api/src/generated/prisma`).

Usuarios de la demo:

| Quién | Cómo entra |
| --- | --- |
| Dueño (Carlos) | `dueno@demo.com` / `demo1234` (PIN de caja `0000`) |
| Sofía (vende y carga stock) | local `DEMO01`, usuario `sofia`, PIN `1234` |
| Martín (vende) | local `DEMO01`, usuario `martin`, PIN `5678` |

## Configuración extra (`almacen/api/.env`)

Además de las variables de Super Chino: `PUBLIC_URL`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET` y `SECRETS_KEY` (ver `.env.example`). Las pruebas usan un Mercado Pago simulado (`web/e2e/fake-mp.mjs`); para probar con Mercado Pago de verdad, usá las credenciales de prueba de tu aplicación.

## Pruebas

```bash
pnpm almacen:test   # API (base almacen_test) + lógica de la caja
pnpm almacen:e2e    # de punta a punta con Playwright (base almacen_e2e)
pnpm typecheck
```

## Publicar

`docker build -f almacen/Dockerfile -t almacen .` desde la raíz. En Render: **New → Web Service → Docker**, con *Dockerfile Path* `almacen/Dockerfile` y una base PostgreSQL propia (por ejemplo, Neon gratis) en `DATABASE_URL`.
