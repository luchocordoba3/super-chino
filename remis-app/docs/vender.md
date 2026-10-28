# Cómo vender Rinde (cobro casero)

Guía para vender la app a choferes de Uber, DiDi, Cabify, inDrive y remis, sin servidor ni pasarela de pago:
1. El chofer transfiere.
2. Te manda el comprobante por WhatsApp.
3. Vos le pasás un **código de activación**.

## Lo que encontré (octubre 2026)

### El cliente
- **Más de un millón de argentinos** trabajan con apps.
- Entre el **50% y el 60%** de lo que facturan se va en gastos (el combustible es cerca del 30%), y muchos están endeudados.
- Las tarifas por km bajaron y hubo "apagones" de choferes por las comisiones.
- Las dos preguntas que tienen todos los días: **¿cuánto gano de verdad?** y **¿me conviene este viaje?**

### Comisiones de referencia
Son las que la app usa por defecto si anotás lo bruto, y cada uno las cambia:

| App | Comisión |
| --- | --- |
| Uber | alrededor del 30% (35–40% en algunas zonas) |
| DiDi | 25–30% |
| Cabify | alrededor del 25% (no encontré un dato oficial) |
| inDrive | 9–10% |

### Reglas nuevas en CABA (mayo 2026)
Por un fallo judicial, los choferes de apps necesitan lo mismo que los taxis:
- licencia profesional;
- seguro de transporte de pasajeros;
- VTV;
- 21 años o más.

Los avisos de vencimientos de la app sirven justo para eso.

### Competencia
| App | Precio | Cómo funciona |
| --- | --- | --- |
| Ruta Rentable (Argentina y LatAm) | 3 días gratis, después suscripción | Analiza los viajes antes de aceptarlos |
| StopClub (Brasil) | R$ 10,90 por mes (unos US$ 2), 7 días gratis | Calcula ganancia por km y por hora |
| Gridwise (EE. UU.) | Gratis + versión paga | Kilometraje y ganancias |

Las dos primeras son apps nativas que leen la pantalla de Uber. Una app web no puede hacer eso. Lo nuestro es **la cuenta completa**:
- ganancia real, comisiones, combustible, service, papeles, monotributo, alquiler y chofer 50/50;
- **anda sin internet**;
- **los datos no salen del celular**;
- **sin débito automático**.

### Precio
- **Mensual $ 3.500** (unos US$ 2,3 con el dólar a $ 1.550), en línea con la competencia.
- **Anual $ 20.000**: sale como 5,7 meses, así que el chofer ahorra $ 22.000 contra pagar 12 meses.
- Sin "para siempre": con renovaciones tenés una ganancia que se puede estimar, y no se corta cuando el mercado se llena.
- Por transferencia no hay comisión. Con Mercado Pago Checkout se pagaría entre 4,5% y 6,5% + IVA.
- **14 días de prueba** con todo. Es más que la competencia, porque para ver la ganancia real hacen falta un par de semanas de datos.

### Por qué la web y no Play Store (por ahora)
Si la app está en Play Store y cobra algo digital, Google obliga a usar su sistema de pagos y se queda con el 15%. Por eso conviene venderla por la web (se instala desde el navegador) y subirla a Play más adelante.

## Cómo funciona el cobro casero

- **Prueba:** el chofer instala la app y tiene 14 días gratis.
- **Cuando se termina la prueba:**
  - puede ver todo y hacer la copia de seguridad, pero no anotar cosas nuevas;
  - la hoja **Activá Rinde** le muestra los planes, tus datos para transferir y un botón que abre WhatsApp con el mensaje armado, que incluye su **código de celular** (8 letras, por ejemplo K7P2-9QXM).
- **Cuando te llega la transferencia:**
  - abrís el **panel del vendedor**;
  - cargás su código de celular y el plan;
  - tocás **Mandar por WhatsApp**: le llega un link, lo toca y queda activada.
- **Seguridad del código:** está firmado con tu clave privada.
  - La app lo verifica sin internet.
  - Nadie puede inventar uno, aunque mire el código de la app.
  - Solo sirve en ese celular. Si cambia de teléfono y restaura su copia, le sigue andando.
- **Renovaciones:**
  - el panel te muestra quién vence en los próximos 30 días, con un botón para avisarle por WhatsApp;
  - el código nuevo arranca cuando termina el anterior, así no se pierden días.
- **Promos:** podés hacer códigos "para cualquiera" con unos días de regalo. Sirven para sorteos, grupos o para que lo prueben más.

## Paso a paso (una sola vez)

1. Publicá la app en Render (ver "Publicarla en Render" en el README) y abrila desde tu celular.
2. Entrá al **panel del vendedor**: Ajustes → tocá 5 veces la línea de abajo de todo (la que dice la versión), o abrí `tu-sitio/vendedor`.
3. Tocá **Crear mi clave de vendedor**.
4. Tocá **Bajar mi clave** y guardá el archivo `clave-vendedor.json` en un lugar seguro (Drive o un chat de WhatsApp con vos mismo).
   - Si perdés el celular sin ese archivo, los códigos nuevos dejan de servir.
   - No se lo pases a nadie.
5. Tocá **Copiar clave pública**.
6. En Render, en tu sitio, entrá a **Environment** y completá:

   | Variable | Qué poner | Ejemplo |
   | --- | --- | --- |
   | `VITE_LICENSE_PUBLIC_KEYS` | la clave pública que copiaste | — |
   | `VITE_PAY_ALIAS` | tu alias | `rinde.app.mp` |
   | `VITE_PAY_CBU` | tu CBU o CVU (opcional) | — |
   | `VITE_PAY_HOLDER` | el titular | `Luciano C.` |
   | `VITE_PAY_BANK` | el banco | `Mercado Pago` |
   | `VITE_SELLER_WHATSAPP` | tu WhatsApp con 549, sin espacios | `5491122334455` |
   | `VITE_PRICE_MES` | precio del mes (por defecto $ 3.500) | `3500` |
   | `VITE_PRICE_ANUAL` | precio del año (por defecto $ 20.000) | `20000` |
   | `VITE_TRIAL_DAYS` | días de prueba (por defecto 14) | `14` |

7. Tocá **Manual Deploy → Deploy latest commit**.
8. Cuando termine, abrí el panel: tiene que decir "Listo: esta versión de la app reconoce tu clave".
9. **Tu propia licencia:** en "Nuevo código" tocá **Es para este celular**, elegí el plan y después **Activar en este celular**.

Mientras `VITE_LICENSE_PUBLIC_KEYS` esté vacía, la app queda **libre**: sin prueba ni códigos.

### Qué pasa si…
- **Cambiás el precio:** cambiás la variable en Render y volvés a desplegar. Los códigos que ya diste siguen valiendo.
- **Perdés el archivo de la clave:** creá una nueva y agregá la clave pública nueva en `VITE_LICENSE_PUBLIC_KEYS` separada por coma, **sin borrar la vieja**. Así los códigos viejos siguen andando.
- **Un cliente cambia de celular:**
  - si restaura su copia de seguridad, el código le sigue andando;
  - si empezó de cero, tiene un código de celular nuevo: le das un código nuevo para ese celular, con monto $ 0.
- **Un cliente pide la devolución:** le devolvés la transferencia. Su código vence solo en la fecha que tenía.
- **Usás "Borrar todo" o "Cargar datos de ejemplo"** en tu celular: no te borran la clave ni las ventas. Igual hacé copias seguido, porque la copia de seguridad también las guarda.

## Dónde promocionarla
- Grupos de WhatsApp y Facebook de choferes de tu ciudad, que existen para cada app.
- TikTok o Reels de 20 segundos mostrando "¿Me conviene este viaje?" con un viaje real.
- Paradas de remises y estaciones de GNC: un cartel con un QR al sitio.
- Un promo de 7 días para cada grupo nuevo, para que la prueben más.

## Cuando se venda bien
- Cobro automático con Mercado Pago (Checkout Pro). Hace falta un servidor chico para crear el pago y recibir el aviso.
- Página de venta con términos y condiciones, política de privacidad y **botón de arrepentimiento**, que es obligatorio para vender por internet (Res. 424/2020: link visible en la página de inicio, sin registrarse, código de respuesta en 24 h y 10 días para arrepentirse).
- Si algún día hay débito automático, también el **botón de baja** (Res. 316/2018 y 357/2021).
- Subirla a Play Store con su sistema de pagos.

**Una nota:** como sos monotributista G, estas ventas suman a tu facturación del año. Hacer la factura C desde ARCA ("Comprobantes en línea") lleva un minuto por venta.

## Fuentes
- Comisiones de pasarelas en Argentina 2026: [talo.com.ar](https://talo.com.ar/blogs/comisiones-pasarelas-de-pago), [comparapasarelas.com](https://www.comparapasarelas.com/mercado-pago-comisiones)
- Choferes de apps (cantidad, gastos, endeudamiento):
  - [El Economista](https://eleconomista.com.ar/economia/conviene-manejar-una-app-cuanto-gana-hora-gasto-come-50-n97653)
  - [Infobae](https://www.infobae.com/economia/2026/03/20/el-crecimiento-de-las-apps-sumo-miles-de-choferes-pero-advierten-que-la-actividad-dejo-de-ser-rentable-tiene-que-haber-algun-tipo-de-regulacion/)
  - [Mi8](https://mi8.com.ar/choferes-de-apps-convocan-a-un-apagon-nacional-por-las-tarifas-a-veces-son-mas-bajas-que-el-valor-de-un-colectivo/)
  - [0223](https://www.0223.com.ar/nota/2026-2-6-14-6-33-conductores-de-uber-didi-y-cabify-realizan-apagon-nacional-por-bajas-en-sus-comisiones)
- Comisiones de las apps: [iProfesional](https://www.iprofesional.com/finanzas/465221-cuanto-se-gana-con-uber-o-cabify-en-2026-y-cuanto-cuesta-entrar), [inDrive Argentina](https://indrive.com/es-ar/driver)
- Reglas en CABA: [El Economista](https://eleconomista.com.ar/economia/cambian-reglas-uber-cabify-didi-caba-exige-ahora-justicia-conductores-n94775), [Noticias Argentinas](https://noticiasargentinas.com/economia/movilidad/uber--cabify--didi-y-taxis-en-caba--cuales-son-las-nuevas-reglas-para-los-choferes-y-que-requisitos-deberan-cumplir_a6a158745d3cd8e54999c3b5b)
- Competencia:
  - [Ruta Rentable en Google Play](https://play.google.com/store/apps/details?id=com.wsb.dalehelperdriver&hl=en_US)
  - [StopClub](https://site.stopclub.com.br/app-cdgpro)
  - [Gridwise](https://gridwise.io/)
- Monotributo (valores desde el 1/8/2026): [ARCA](https://www.afip.gob.ar/monotributo/categorias.asp), [TributoSimple](https://tributosimple.com/categorias-del-monotributo-vigentes/)
- Botón de arrepentimiento: [Res. 424/2020](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-424-2020-342869/texto). Botón de baja: [argentina.gob.ar](https://www.argentina.gob.ar/noticias/las-empresas-deben-publicar-los-contratos-y-el-boton-de-baja-en-su-web-principal)
- Play Store y pagos digitales: [Chrome Developers](https://developer.chrome.com/docs/android/trusted-web-activity/receive-payments-play-billing)
- Dólar al 30/9/2026: [La Nación](https://www.lanacion.com.ar/economia/dolar/dolar-hoy-y-dolar-blue-en-vivo-a-cuanto-cotiza-el-oficial-y-cual-es-el-precio-del-paralelo-este-nid29092026/)
