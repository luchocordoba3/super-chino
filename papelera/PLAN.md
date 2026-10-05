# Papelera: plan para vender digital y conseguir clientes B2B

**Punto de partida:**
- Cobrás $15M de deuda en mercadería de fábrica: limpieza, descartables, bolsas, papel y embalaje.
- Retirás a medida que vendés y repartís con tu camioneta en CABA y GBA.
- Facturás como monotributista (factura C).

**Objetivo:** convertir esa mercadería en plata y en una cartera de clientes que vuelvan a comprar, para seguir después con capital propio.

---

## 1. Los números

| | Base |
|---|---|
| Mercadería a costo de fábrica | $15.000.000 |
| Tu precio por mayor | costo + 30% |
| Tu precio suelto | costo + 50% |
| Artículos en tu lista | 248, en 6 rubros |

Ganancia bruta si vendieras todo a un solo precio: **$4,5M** por mayor y **$7,5M** suelto. En la práctica vas a mezclar canales. Este es un escenario razonable:

| Canal | % del stock | Costo | Ventas | Ganancia bruta |
|---|---|---|---|---|
| B2B por mayor (+30%) | 50% | $7,5M | $9,75M | $2,25M |
| Venta directa suelta: web, WhatsApp, Instagram (+50%) | 30% | $4,5M | $6,75M | $2,25M |
| Marketplaces (+77%, menos ~15% de comisión) | 20% | $3,0M | $5,31M → $4,51M neto | $1,51M |
| **Total** | | **$15M** | **~$21,8M** | **~$6,0M** |

A esos ~$6M todavía hay que restarles los gastos: gasoil y peajes, monotributo, publicidad (para arrancar, 3 a 5% de lo que vendas) y bolsas o cajas para armar pedidos. Una meta realista es **$4,5M a $5,5M de ganancia neta**, además de la cartera de clientes, que es lo que más vale.

**Regla de precio para marketplaces:** tu precio suelto no alcanza en Mercado Libre, porque la comisión se come el margen. Para mantener el +50%, el precio de publicación tiene que ser `costo × 1,5 ÷ (1 − comisión)`. Con 15% de comisión eso da costo × 1,77, o sea **tu precio suelto + 18%**. Lo mejor es vender en packs (por ejemplo, 5 paquetes de bolsas de consorcio), que suben el ticket y diluyen el costo de envío. Las comisiones cambian por categoría: antes de publicar, revisalas en la calculadora de Mercado Libre.

## 2. Tres cosas a resolver antes de arrancar

1. **La deuda pierde valor con la inflación.** La deuda está fija en pesos. Cada vez que la fábrica actualiza su lista, tus $15M te dan menos unidades. Conviene:
   - acordar por escrito que **todo el saldo se retira a la lista de costo vigente** (la "Lista empleados julio 26" que tenés), o
   - **retirar pronto lo que más rota**, aunque quede guardado en la camioneta o el depósito.

   Llevá una planilla con cada retiro: fecha, artículos, importe y saldo.
2. **Factura C.** Los clientes Responsables Inscriptos no pueden descontar el IVA de tu factura, así que para ellos sos un 21% más caro que alguien que da factura A. Por eso el foco va en quienes no lo necesitan: monotributistas (la mayoría de rotiserías, bares chicos, peluquerías, almacenes), consorcios y consumidores finales. Si más adelante aparece mucho cliente grande, se evalúa pasar a Responsable Inscripto.
3. **Tope del monotributo.** Vas a facturar unos $20M o más en pocos meses. Revisá en ARCA que tu categoría cubra lo que vas a facturar en 12 meses y recategorizate si hace falta.

## 3. Qué retirar primero

Lo que se consume todas las semanas y no vence. En la web y en la calle se empuja esto:

| Rubro | Artículos que rotan | Códigos de ejemplo |
|---|---|---|
| Bolsas | Consorcio 60×90 y 80×100, residuos 45×60 y 50×70, camisetas | LB0003, LB0006, LB0089, LB0074, PB0110 |
| Papel | Higiénico institucional, toallas intercaladas, servilletas 24×24 | LP0114, LT0045, PS0004 |
| Químicos en bidón de 5 L | Lavandina, detergente, desengrasante, jabón de manos | LL0228, LD0279, LD0248, LJ0087 |
| Descartables | Vasos de 500 cc, cubiertos ×1000, bandejas de cartón | PV0007, PC0302, PC0303, PB0141 |

Lo caro y lento (bandejas por 200, servilletas Elite intercaladas, cabos telescópicos) se trae **solo con pedido confirmado**.

## 4. A quién venderle

Los segmentos van ordenados por cuánto rinde cada esfuerzo de venta:

1. **Administraciones de consorcio.** Una administración maneja entre 20 y 60 edificios, así que es el contacto que más rinde. Compran bolsas de consorcio, lavandina, detergente, trapos y escobillones todos los meses. La propuesta es la reposición mensual por edificio con el *Kit Consorcios*.
2. **Empresas de limpieza tercerizadas.** Compran mucho volumen y miran el precio: precio por mayor y entrega fija.
3. **Gastronomía chica:** rotiserías, pizzerías, hamburgueserías, heladerías, cocinas de delivery y bares. Compran descartables, servilletas, bolsas, rollos de cocina y desengrasante, y reponen cada semana. *Kit Gastronomía*.
4. **Oficinas, consultorios, gimnasios, peluquerías y veterinarias.** Papel, toallas, jabón, aerosoles y bolsas. *Kit Oficinas y locales*.
5. **Revendedores:** almacenes, autoservicios, kioscos y ferreterías de barrio. Les vendés por mayor y ellos ponen su precio. Pagan menos margen, pero mueven bultos.
6. **Jardines, colegios privados y clubes.** Compran de a mucho y pocas veces; se trabajan por mail o WhatsApp con el administrativo.

## 5. Cómo diferenciarte

Muchas papeleras de barrio compiten por precio y atienden por teléfono. Vos competís por **comodidad y confianza**:

- **Precio por mayor publicado y transparente.** La mayoría no publica precios. Vos mostrás la lista entera con el umbral claro: por mayor desde $150.000 (se ajusta en `web/config.js`).
- **Pedido en dos minutos desde el celular.** El cliente arma el pedido y te llega por WhatsApp con el detalle completo, sin errores de dictado.
- **Reparto con día fijo por zona**, dos veces por semana. El cliente sabe cuándo llega.
- **Kits por rubro y reposición mensual.** Le resolvés la compra a quien no quiere pensar en eso.
- **Respuesta en menos de una hora en horario comercial.** Es lo que más se nota frente a la competencia.

## 6. Canales digitales

| Canal | Para qué | Qué hacer |
|---|---|---|
| **Web catálogo** (`papelera/web/`) | Lista de precios, kits y pedidos por WhatsApp | Completar `config.js` y publicarla (ver §10). Va en la bio de Instagram, en el perfil de Google y en cada mensaje. |
| **WhatsApp Business** | Cerrar ventas y que vuelvan a comprar | Catálogo con los 30 más vendidos, respuestas rápidas (precios, zonas, formas de pago) y etiquetas: *prospecto, cotizado, cliente, recompra*. Una lista de difusión por rubro con una oferta por semana. |
| **Perfil de Empresa de Google** | Aparecer en "papelera cerca de mí" y "artículos de limpieza por mayor" | Categoría de distribuidor o proveedor de artículos de limpieza, zona de reparto, horario, fotos **reales** de la camioneta y la mercadería, y link a la web. Pedirle reseña a cada cliente contento. |
| **Instagram** | Mostrar que existís y que repartís todos los días | 3 publicaciones por semana: un producto con su precio por mayor, un kit por rubro y un video corto de reparto o de pedido armado. Historias con "salió hoy para…". Destacadas: *Lista, Kits, Reparto, Cómo comprar*. |
| **Mercado Libre** | Venta suelta y visibilidad | 30 a 40 publicaciones en **packs** de los artículos que más rotan, con la regla de precio del §1. Activar **Envíos Flex** para entregar en el día en AMBA con tu camioneta (revisá los requisitos en tu cuenta). |
| **Facebook Marketplace y grupos** | Venta suelta local gratis | Publicar kits y packs en Marketplace y en grupos de comerciantes y gastronómicos de cada zona. |

## 7. Cómo conseguir clientes B2B

**Armado de la lista (una hora por día).** En Google Maps buscás por zona de reparto: "rotisería", "pizzería", "administración de consorcios", "empresa de limpieza", "gimnasio", "peluquería", "veterinaria", "jardín maternal". Cargás cada uno en una planilla con estas columnas: *negocio, rubro, zona, teléfono, contacto, estado, próximo paso, fecha, ticket*. Meta: **30 prospectos nuevos por día**.

**Visita en camioneta, en el día de reparto de cada zona.** Entre entrega y entrega, visitás de 10 a 15 negocios cercanos y llevás:
- una muestra (un paquete de bolsas de consorcio o de servilletas);
- la lista impresa de una hoja con los 30 más vendidos y un QR a la web;
- la pregunta clave: *"¿A quién le comprás hoy y cada cuánto te entregan?"*

**Primer mensaje por WhatsApp (para administraciones, empresas y colegios):**
> Hola, ¿cómo andás? Soy [nombre], de [papelera]. Repartimos artículos de limpieza, bolsas y descartables en [zona] los [días], con precio por mayor y factura. Para consorcios armamos la reposición mensual por edificio. Te dejo la lista con precios: [link]. ¿Te paso una cotización con lo que usan hoy?

**Seguimiento.** Si no responde, volvés a escribir a los 3 días con una oferta concreta, y a los 10 días le pasás por la puerta en el día de reparto.

**Oferta de entrada.** En el primer pedido, envío sin cargo sin mínimo, o el kit por rubro con 5% de descuento. Una sola oferta por cliente.

**Recompra.** A los 25 días del pedido le mandás: *"¿Te repito el pedido del mes pasado? Sale el [día]."* Un cliente que repite vale más que tres nuevos.

**Métricas semanales** (anotalas en una planilla los viernes):
- prospectos nuevos;
- contactados;
- visitas;
- cotizaciones;
- primeros pedidos;
- conversión (primeros pedidos ÷ contactados);
- ticket promedio;
- clientes que recompraron;
- saldo de deuda por retirar.

## 8. Logística

- **Zonas por día:** CABA lunes y jueves, GBA Norte y Oeste martes y viernes, GBA Sur miércoles y sábados. Se ajusta según dónde aparezcan los clientes (`web/config.js`).
- **Corte de pedidos:** hasta las 17 h para salir en el próximo recorrido.
- **Envío sin cargo desde $80.000.** Debajo de eso, el envío se cobra o se espera al recorrido.
- **Ruta:** armala la noche anterior con Google Maps (hasta 10 paradas) y anotá el gasoil por día para conocer el costo por entrega.
- **Cobro:** transferencia o Mercado Pago al entregar. Al principio, sin cuenta corriente; más adelante, solo a clientes que ya repitieron 3 veces.

## 9. Calendario de 90 días

| Semana | Foco | Meta |
|---|---|---|
| 1 | Base: monotributo y cobro (cuenta, Mercado Pago), nombre y logo simple, WhatsApp Business, Instagram, Perfil de Google y la web publicada con tus datos. Primer retiro de alta rotación (unos $2,5M a costo). | Todo publicado |
| 2 | Mercado Libre (30 packs), Facebook Marketplace, lista de 150 prospectos, primeras 40 visitas o contactos. | 5 primeros pedidos |
| 3–6 | Rutina: reparto y visitas en cada zona, 30 prospectos por día y seguimiento. Retiros semanales según ventas. | 25 clientes con primer pedido y 8 que repiten |
| 7–9 | Reposición mensual armada, foco en administraciones y empresas de limpieza, ajustar surtido según lo que se vende. | 15 clientes recurrentes y 60% de la deuda retirada |
| 10–12 | Retirar el saldo de la deuda, medir ganancia real, decidir reinversión. | Deuda cobrada al 100% |

## 10. Después: reinversión

- Comprarle a la misma fábrica **como cliente**, con condiciones negociadas por volumen, para no quedarte sin los artículos que ya tienen clientes.
- Sumar un **segundo proveedor** para lo que te piden y no tenés (café y azúcar para oficinas, guantes de nitrilo, papel madera).
- **Publicidad paga** en Instagram y Facebook segmentada por zona de reparto y rubro, recién cuando la recompra funcione. Empezar con poco y medir costo por cliente nuevo.
- **Panel administrativo** de la web, para cambiar precios, stock, kits y zonas sin tocar código. Es el próximo paso técnico.

---

## Web catálogo: cómo usarla

Archivos en `papelera/web/`:
- `index.html`, `estilos.css` y `app.js`: la web.
- `config.js`: **tus datos** (nombre, WhatsApp, zonas, montos mínimos y kits). Es lo único que hay que editar.
- `productos.js`: la lista de precios. **No se edita a mano.** Se genera desde el PDF:

  ```bash
  python3 papelera/scripts/generar-catalogo.py papelera/datos/lista-de-precios.pdf
  ```

  Necesita `pdftotext` (paquete `poppler-utils`). Si alguna línea no se pudo leer, el script avisa.

**Privacidad:** la web muestra solo tus precios de venta. La lista de costo de fábrica (el Excel) **no se sube a ningún lado**.

**Publicarla gratis:**
- **Netlify Drop:** entrás a app.netlify.com/drop y arrastrás la carpeta `web`. En un minuto tenés un link.
- **Cloudflare Pages** o **GitHub Pages:** tomás la carpeta `papelera/web` del repositorio.
- **Dominio propio:** un `.com.ar` en NIC Argentina sale poco por año y da mucha más confianza que un link gratuito.

**Antes de publicar:**
- completar `whatsapp`, `nombre` e `instagram` en `config.js`;
- revisar los montos mínimos y las zonas;
- sacar fotos reales de la camioneta y la mercadería para Instagram y Google (las fotos propias generan más confianza que cualquier imagen de banco).
