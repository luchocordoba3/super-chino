# memebot: US$100.000 o desaparecer

Bot que opera memecoins en Solana, solo y las 24 horas, con una única meta:

- **Si el capital llega a US$100.000:** vende todo a USDC, avisa y **no vuelve a operar**.
- **Si el capital cae por debajo de US$10:** vende lo que quede, avisa y **se apaga para siempre**.

Es independiente de la app del súper: no forma parte del workspace de pnpm ni de su deploy.

> ⚠️ **Leé esto antes de usarlo con dinero real.** Lo más probable es perder todo el capital.
> La mayoría de las memecoins terminan en estafa. Cada compra y venta completa cuesta entre 0,5% y 3%
> (slippage, impacto en el precio y comisiones), y ninguna regla garantiza ganancias. Usá solo plata
> que estés dispuesto a perder entera.

## Cómo decide

Cada 15 segundos revisa las posiciones abiertas y cada 60 segundos busca candidatas. Las toma de dos lugares: los pools en tendencia de GeckoTerminal y las monedas promocionadas en DexScreener.

**Para entrar**, una moneda tiene que pasar todos estos filtros:

1. **Mercado:**
   - liquidez de al menos US$30k y volumen de la última hora de al menos US$50k;
   - entre 30 minutos y 72 horas de vida;
   - capitalización entre US$100k y US$20M;
   - más compras que ventas;
   - suba a 5 min y suba a 1 h entre +10% y +200%.
2. **Puntaje:** combina presión compradora, aceleración del volumen, tendencia y liquidez. Solo compra la mejor candidata si supera 0,5.
3. **Anti-estafa.** Ante la duda, no compra:
   - Nadie puede emitir más monedas ni congelarlas.
   - En Token-2022, no tiene extensiones peligrosas (comisión por transferencia, hook, delegado permanente, pausable).
   - RugCheck no marca ningún riesgo grave ("danger"). Si RugCheck no responde, tampoco compra.
   - Hay ruta para venderla: se prueba cotizando una venta de US$1.
4. **Tamaño:** el menor entre 25% del capital, 2% de la liquidez del pool y el monto con el que el impacto en el precio queda ≤ 2%. Tiene como máximo 3 posiciones abiertas a la vez.

**Para salir:**
- **Stop-loss:** −25%.
- **Toma de ganancia:** en +50% vende la mitad. El resto se vende si el precio cae 25% desde el máximo.
- **Corte por tiempo:** si a los 90 min no subió al menos +10%, vende.
- **Si la liquidez cae más de 50%** (señal de estafa en curso), vende de urgencia, aceptando más slippage.
- **Si va perdiendo y dominan las ventas**, vende.

Si una venta falla, la reintenta subiendo el slippage. Después de 4 pérdidas seguidas se toma 60 minutos sin comprar. No vuelve a entrar en la misma moneda por 6 horas.

El bot **nunca transfiere fondos** a otra dirección: solo intercambia USDC ↔ memecoins dentro de su propia billetera, a través de Jupiter.

## 1. Probar en simulación (recomendado: al menos una semana)

Necesitás Node 22.

```bash
cd memebot
npm install
cp .env.example .env      # MODE=paper viene por defecto
npm run paper
```

En la simulación usa precios y cotizaciones reales de Jupiter con US$100 virtuales, y descuenta una comisión y 1% de slippage por operación. En otra terminal podés ver cómo va:

```bash
npm run status
```

El historial queda en `data/trades-paper.jsonl`. Si los resultados no te convencen, ajustá los parámetros en `.env`. La lista completa con sus valores por defecto está en `src/config.ts`.

## 2. Operar con dinero real

1. Creá una billetera **nueva**, usada solo por el bot (por ejemplo, una cuenta nueva en Phantom), y exportá su clave privada. Nunca uses tu billetera principal.
2. Cargale los **USDC** que vas a arriesgar y unos **0,1 SOL** para pagar las comisiones de red.
3. En `.env` completá:
   - `MODE=live`
   - `WALLET_PRIVATE_KEY=...`
   - `SOLANA_RPC_URL`: un RPC propio (Helius tiene plan gratis); el público falla seguido al enviar transacciones.
4. Arrancá con `npm start`. Al inicio muestra la dirección y los saldos de la billetera.

Si Jupiter empieza a pedir clave de API, sacala gratis en portal.jup.ag y poné `JUP_API_URL=https://api.jup.ag` y `JUP_API_KEY=...`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca en el modo de `.env` |
| `npm run paper` | Arranca en simulación, diga lo que diga `.env` |
| `npm run status` | Capital, avance hacia la meta y posiciones abiertas |
| `npm run panic` | En el próximo ciclo vende todo y deja de comprar |
| `npm run resume` | Desactiva el pánico |
| `npm run reset -- --yes` | Archiva el estado (no lo borra) para empezar de cero. Primero detené el bot |
| `npm test` | Tests (sin red) |

Ctrl+C lo detiene ordenadamente: termina el ciclo en curso, guarda el estado y, al volver a arrancar, retoma las posiciones abiertas.

## 3. Dejarlo corriendo 24/7

Conviene un VPS chico (Hetzner, DigitalOcean o similar, US$5–6 por mes) con Docker:

```bash
cd memebot
cp .env.example .env   # completalo
docker compose up -d --build
docker compose logs -f                   # ver qué hace
docker compose exec memebot npm run status
docker compose exec memebot npm run panic
```

El estado queda en `memebot/data/`. El contenedor se reinicia solo si se cae o si se reinicia el servidor. Cuando el bot gana o quiebra, queda en reposo sin operar.

El plan gratis de Render no sirve para esto: se duerme cuando no recibe visitas y borra el disco en cada reinicio.

**Avisos por Telegram (opcional):** completá `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` para recibir:
- compras y ventas;
- errores;
- un resumen diario;
- el aviso final, al ganar o al quebrar.

## Límites

- Las APIs externas (DexScreener, GeckoTerminal, RugCheck, Jupiter) pueden cambiar de formato. El bot valida cada respuesta: si algo no cierra, lo registra en el log y no opera con ese dato.
- En la quiebra, las monedas que ya no tienen ruta de venta (estafas consumadas) quedan en la billetera sin valor.
- Al ganar, el monto final puede quedar apenas por debajo de US$100.000 por el slippage de la última venta.
