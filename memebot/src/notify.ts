import type { Config } from './config';
import { log, type Fetch } from './util';

export type Notifier = (msg: string) => Promise<void>;

/** Escribe en el log y, si está configurado, avisa por Telegram. Nunca lanza errores. */
export function makeNotifier(
  cfg: Pick<Config, 'MODE' | 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_CHAT_ID'>,
  fetchImpl: Fetch = fetch,
): Notifier {
  return async (msg) => {
    log('info', msg);
    if (!cfg.TELEGRAM_BOT_TOKEN || !cfg.TELEGRAM_CHAT_ID) return;
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${cfg.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.TELEGRAM_CHAT_ID, text: `[memebot ${cfg.MODE}] ${msg}` }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) log('warn', `Telegram respondió ${res.status}`);
    } catch {
      // No se registra la URL: lleva el token del bot.
      log('warn', 'no se pudo avisar por Telegram');
    }
  };
}
