import { createECDH, createHash } from 'node:crypto';
import webpush from 'web-push';
import { prisma } from '../db';
import { env } from '../env';

export interface PushMessage {
  title: string;
  body: string;
  /** A dónde lleva al tocar el aviso. */
  url: string;
}

/** Claves VAPID: las configuradas o, si no hay, derivadas del secreto de sesión (estables entre reinicios). */
function vapidKeys() {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const priv = createHash('sha256').update(env.JWT_SECRET + ':vapid').digest();
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(priv);
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: priv.toString('base64url') };
}

const keys = vapidKeys();
webpush.setVapidDetails(env.PUSH_SUBJECT, keys.publicKey, keys.privateKey);

export const vapidPublicKey = keys.publicKey;

/** Manda el aviso a todos los celulares de la vidriería. Nunca falla: si un celular ya no existe, lo borra. */
export async function notify(businessId: string, msg: PushMessage) {
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { businessId } });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 3600 });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        }
      }),
    );
  } catch {
    // un aviso que no sale no puede romper lo que lo disparó
  }
}

/** Sin esperar: el que dispara el aviso responde enseguida. */
export function notifyLater(businessId: string, msg: PushMessage) {
  void notify(businessId, msg);
}
