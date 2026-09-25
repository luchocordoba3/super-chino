# memebot: 4 agentes, meta US$2.000.000

Bot en Python que opera memecoins en Solana, solo y las 24 horas, con cuatro agentes:

| Agente | Qué hace | Cómo |
|---|---|---|
| **Director** | Genera tesis de inversión, pide cerrar las posiciones cuya tesis se invalidó y una vez por día escribe las lecciones aprendidas | Claude Opus 5 |
| **Quant** | Valida cada tesis contra los datos; si los números no la sostienen, la rechaza | Claude Sonnet 5 |
| **Risk manager** | Decide el tamaño y el plan de salida (stop-loss, toma de ganancia, stop dinámico, plazo) | Claude Sonnet 5 |
| **Ejecución** | Compra, vende y retira en Solana: cotiza, controla el impacto en el precio, firma y confirma | Código, sin IA |

La IA nunca toca la clave privada ni elige montos por fuera de los topes. La ejecución solo hace lo que aprobó el risk manager, y los topes duros se aplican en código:
- tamaño máximo por operación;
- stop-loss mínimo y máximo;
- cantidad máxima de posiciones;
- impacto máximo en el precio.

Además, un mint que el director invente se descarta: solo se operan monedas que vinieron del escáner.

Es independiente de la app del súper: no forma parte del workspace de pnpm ni de su deploy.

> ⚠️ **Leé esto antes de usarlo con dinero real.** Lo más probable es perder todo el capital. La mayoría de las
> memecoins terminan en estafa, cada compra y venta completa cuesta entre 0,5% y 3%, y ninguna IA predice
> el precio. A eso se suma el costo de los agentes: aproximadamente US$15 por día (unos US$460 por mes) con la
> configuración por defecto. Usá solo plata que estés dispuesto a perder entera.

## Metas y retiros

El **patrimonio** es el capital en la billetera del bot más todo lo que ya se retiró.

| Patrimonio | Qué pasa |
|---|---|
| US$100k · 300k · 600k · 1M · 1,5M | Retira a tu billetera segura (`WITHDRAW_ADDRESS`) el 50% de la ganancia hecha desde el último retiro y sigue operando |
| **US$2M** | Vende todo, retira todo a tu billetera y **no vuelve a operar** |
| Capital del bot < US$10 | Vende lo que quede y **se apaga para siempre**. Lo ya retirado está a salvo |

Por ejemplo, empezando con US$1.000:
- **Meta de US$100k:** retira US$49.500 y sigue operando con US$50.500.
- **Meta de US$300k:** hace falta que el capital en el bot llegue a US$250.500; retira US$100.000.
- **Siguientes metas:** siguen la misma lógica hasta llegar a US$2M.

Si al pasar una meta el efectivo está invertido, el retiro queda pendiente y sale cuando se cierran posiciones. Mientras tanto, esa plata no se usa para compras nuevas.

Los retiros solo pueden ir a `WITHDRAW_ADDRESS`, que sale del `.env`: ningún agente la puede cambiar. No agregues fondos a la billetera del bot después de arrancar, porque se contarían como ganancia. Si querés sumar capital, detené el bot y empezá de cero con `reset --yes`.

## Cómo funciona un ciclo

1. **Cada 15 segundos (sin IA):** revisa las posiciones abiertas y aplica el plan de salida de cada una.
   - **Stop-loss:** vende todo si cae el porcentaje que fijó el risk manager (entre 5% y 40%).
   - **Al duplicar:** vende la mitad, con lo que recupera lo invertido. El resto queda corriendo con un stop que sigue el precio máximo (entre 15% y 60%, lo elige el risk manager), para no cortar una moneda que va a multiplicar.
   - **Plazo:** vende si se cumple el plazo de la tesis sin que la moneda haya despegado.
   - **Emergencia:** vende de urgencia si la liquidez cae más de 50%.
2. **Cada 15 minutos:**
   1. **Escáner (gratis):** busca candidatas en GeckoTerminal y DexScreener y las filtra por liquidez, volumen, antigüedad y compras contra ventas. Después aplica los controles anti-estafa y deja las 10 mejores:
      - nadie puede emitir más monedas ni congelarlas;
      - en Token-2022, no tiene extensiones peligrosas;
      - RugCheck no marca riesgos graves;
      - hay ruta para vender.
   2. **Director:** recibe las candidatas y la cartera. Propone hasta 3 tesis o ninguna, y puede pedir cerrar posiciones abiertas.
   3. **Quant:** valida cada tesis, empezando por la de mayor convicción.
   4. **Risk manager:** para cada tesis aprobada, decide el tamaño (hasta 5% del capital) y el plan de salida. Puede haber hasta 8 posiciones abiertas a la vez.
   5. **Ejecución:** compra, con un tope de impacto en el precio y a través de Jupiter.
3. **Aprendizaje:** en cada ciclo mide cuánto multiplicó cada moneda que vio, y una vez por día el director escribe lecciones (ver abajo).
4. **Frenos automáticos:**
   - Después de 4 pérdidas seguidas se toma 60 minutos sin comprar.
   - No vuelve a entrar en la misma moneda por 6 horas.
   - Si se agota el presupuesto diario de IA, no hace compras nuevas hasta el día siguiente, pero las salidas siguen funcionando.

Si no hay candidatas ni posiciones abiertas, no llama a la IA y no gasta.

## Cómo aprende

La estrategia es de muchas apuestas chicas: hasta 5% del capital por compra y hasta 8 posiciones a la vez. La mayoría va a perder poco por el stop-loss; la idea es que unas pocas ganadoras paguen todo.

Para aprender a reconocerlas, el bot no mira solo sus operaciones:
1. **Sigue todas las monedas que ve el escáner**, las compre o no, durante 24 horas, y mide cuánto multiplicaron. También guarda hasta dónde llegó cada una: si la filtró, si la descartó por insegura, si el director la propuso o si la compró.
2. **Una vez por día, el director revisa:**
   - cómo eran, en el momento en que el bot las vio, las que multiplicaron por 3 o más y las que se desplomaron;
   - qué ganadoras se le escaparon y por qué.

   Con eso escribe hasta 10 lecciones concretas.
3. **El director y el quant leen esas lecciones en cada ciclo.** En cada revisión se confirman, se corrigen o se descartan.

El diario queda en `data/learning.json` y se comparte entre simulación y real, así que lo que aprende mientras simulás lo usa cuando arranques con plata. `status` muestra las lecciones vigentes, y la revisión cuesta centavos por día. Con pocos días de datos, las lecciones son hipótesis, no reglas: el aprendizaje mejora a medida que junta observaciones.

## 1. Probar en simulación

Necesitás Python 3.11 o más nuevo y una clave de la API de Anthropic.

```bash
cd memebot
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env        # completá ANTHROPIC_API_KEY; MODE=paper viene por defecto
python -m memebot start --paper
```

La simulación usa precios y cotizaciones reales con US$1.000 virtuales, y descuenta una comisión y 1% de slippage por operación. **Los agentes sí gastan de verdad:** para probar barato, bajá `LLM_DAILY_BUDGET_USD` (por ejemplo, a 3).

```bash
python -m memebot status    # patrimonio, metas, retiros, gasto en IA y posiciones
pytest                      # tests, sin red ni IA
```

El historial de operaciones y retiros queda en `data/trades-paper.jsonl`.

## 2. Operar con dinero real (cuando juntes el capital)

1. Creá una billetera **nueva**, usada solo por el bot, y exportá su clave privada.
2. Cargale los **USDC** que vas a arriesgar y unos **0,1 SOL** para comisiones.
3. En `.env` completá:
   - `MODE=live`
   - `WALLET_PRIVATE_KEY`
   - `WITHDRAW_ADDRESS`: tu billetera segura, la de siempre, **distinta** de la del bot.
   - `SOLANA_RPC_URL`: un RPC propio (Helius tiene plan gratis).
4. Arrancá con `python -m memebot start`. Al inicio muestra la dirección del bot, los saldos y a dónde van los retiros.

Si Jupiter empieza a pedir clave de API, sacala gratis en portal.jup.ag y poné `JUP_API_URL=https://api.jup.ag` y `JUP_API_KEY=...`.

## Comandos

| Comando | Qué hace |
|---|---|
| `python -m memebot start` | Arranca en el modo del `.env` (`--paper` fuerza simulación) |
| `python -m memebot status` | Patrimonio, metas, retiros, gasto en IA y posiciones |
| `python -m memebot panic` | En el próximo ciclo vende todo y no consulta más a los agentes |
| `python -m memebot resume` | Desactiva el pánico |
| `python -m memebot reset --yes` | Archiva el estado (no lo borra) para empezar de cero; las lecciones se conservan. Primero detené el bot |

Ctrl+C lo detiene ordenadamente: termina el ciclo, guarda el estado y, al volver a arrancar, retoma las posiciones abiertas.

## 3. Dejarlo corriendo 24/7

Conviene un VPS chico (US$5–6 por mes) con Docker:

```bash
cd memebot
cp .env.example .env   # completalo
docker compose up -d --build
docker compose logs -f
docker compose exec memebot python -m memebot status
docker compose exec memebot python -m memebot panic
```

El estado queda en `memebot/data/`. El contenedor se reinicia solo si se cae o si se reinicia el servidor. Al ganar o quebrar, queda en reposo sin operar.

**Avisos por Telegram (opcional):** completá `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` para recibir:
- cada compra, con su tesis;
- ventas y retiros;
- metas alcanzadas;
- errores;
- un resumen diario;
- el aviso final.

## Límites

- Las APIs externas pueden cambiar de formato. Cada respuesta se valida: si algo no cierra, se registra en el log y no se opera con ese dato.
- Si el director, el quant o el risk manager fallan o devuelven algo inválido, esa operación no se hace.
- En la quiebra, las monedas sin ruta de venta (estafas consumadas) quedan en la billetera sin valor.
- El costo de la IA depende de cuánto razonen los modelos (`*_EFFORT`) y de cuántas candidatas haya. El tope diario lo limita.
