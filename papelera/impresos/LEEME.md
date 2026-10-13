# Impresos de Doble Hoja

Los PDFs de `pdf/` están listos para mandar a la imprenta: tamaño final más **3 mm de sangrado** por lado, sin marcas de corte y con las tipografías incluidas. En `previas/` hay una imagen de cada cara para mirarlas sin abrir el PDF.

| Archivo | Medida final | Caras | Papel sugerido | Cantidad para arrancar |
|---|---|---|---|---|
| `01-iman-heladera-60x90.pdf` | 6 × 9 cm | 1 | Imán flexible de 0,4 a 0,6 mm con laminado | 500 |
| `02-sticker-reposicion-80x80.pdf` | 8 × 8 cm | 1 | Vinilo autoadhesivo mate (aguanta la humedad) | 300 |
| `03-ficha-A5-doble-faz.pdf` | 14,8 × 21 cm | 2 | Ilustración de 250 a 300 g, mate | 1.000 |
| `04-tarjeta-90x50-doble-faz.pdf` | 9 × 5 cm | 2 | Ilustración de 350 g, mate o laminado soft touch | 500 |
| `05-carpeta-tapa-contratapa-A4-abierta.pdf` | 42 × 29,7 cm abierta | 1 | Ilustración de 300 a 350 g con laminado mate | 40 |
| `06-carpeta-interiores-A4.pdf` | A4 | 3 hojas | Obra de 90 g (se puede imprimir en casa) | Según necesidad |
| `07-ploteo-camioneta-lateral-referencia.pdf` | Referencia 1:10 | 1 | Vinilo de corte o impreso, a cargo del ploteador | — |

## Qué decirle a la imprenta
- **Sangrado:** los archivos ya tienen 3 mm de sangrado y un margen de seguridad de 4 mm hacia adentro del corte.
- **Color:** los PDF salen en RGB. Si la imprenta trabaja en CMYK, que convierta respetando estos colores:

  | Color | Hex | CMYK aproximado |
  |---|---|---|
  | Cobalto | `#17288E` | C84 M72 Y0 K44 |
  | Amarillo cinta | `#F5C32C` | C0 M20 Y82 K4 |
  | Negro texto | `#12141A` | negro enriquecido C60 M50 Y40 K100 |

  En la primera tirada pedí una prueba de color.
- **Carpeta:** el archivo es la carpeta abierta, con la contratapa a la izquierda y la tapa a la derecha. El bolsillo interior y el troquel son los de la imprenta: que acomoden el diseño a su troquel.
- **Ploteo:** es una referencia de proporción 3:1. El ploteador la adapta a las medidas reales de la camioneta (ruedas, puertas y manijas). Dejá el WhatsApp y el QR a la altura de los ojos.

## Los QR
Cada pieza tiene su propio QR. Así, en cada pedido de WhatsApp se ve qué pieza lo trajo, por ejemplo "(Origen: Imán de heladera)".

| Pieza | QR | Lleva a |
|---|---|---|
| Imán | `doblehoja.com.ar/q/iman` | Página de gastronomía |
| Sticker | `doblehoja.com.ar/q/sticker` | Lista de precios |
| Ficha A5 | `doblehoja.com.ar/q/ficha` | Lista de precios |
| Tarjeta | `doblehoja.com.ar/q/tarjeta` | Inicio |
| Carpeta | `doblehoja.com.ar/q/carpeta` | Página de consorcios |
| Camioneta | `doblehoja.com.ar/q/camioneta` | Inicio |

A dónde lleva cada QR se cambia en `sitio/src/datos/negocio.json` (`qr`), o desde el panel, **sin reimprimir**.

**Los QR funcionan recién cuando la web esté publicada en doblehoja.com.ar.** Antes de imprimir, escanealos con el celular.

## Precios con fecha
El dorso de la ficha A5 y la propuesta de la carpeta llevan precios con la fecha en que se generaron. El resto de las piezas no tiene precios, a propósito, para que no queden viejas.

Cuando cambie la lista, regenerá y reimprimí solo esas hojas:

```bash
cd papelera/impresos
npm install
npx playwright install chromium   # solo la primera vez
npm run generar
```

El generador toma todo de la web: el nombre, el WhatsApp, los destacados, los kits y los precios. Para que la tarjeta lleve tu nombre, completá `contacto` en `negocio.json` y regenerá.

## Imágenes para compartir

La vista previa que muestra WhatsApp al mandar un link (una general y una por kit, sin precios) se genera con `npm run compartir`. Las imágenes van a `sitio/public/compartir/`. Volvé a generarlas si agregás o renombrás un kit.
