import { buildApp } from './app';
import { env } from './env';
import { refreshDollar } from './services/dollar';

const app = await buildApp();
await app.listen({ port: env.PORT, host: env.HOST });
if (env.DOLLAR_FETCH) {
  const tick = () => refreshDollar().catch((e) => app.log.warn({ err: e }, 'No se pudo leer el dólar'));
  void tick();
  setInterval(tick, 60 * 60 * 1000).unref();
}
