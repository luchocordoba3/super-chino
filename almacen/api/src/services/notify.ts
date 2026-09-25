import webpush from 'web-push';
import { prisma } from '../db';
import { env } from '../env';

// ---- Tiempo real (Server-Sent Events): avisa a las pantallas abiertas que recarguen datos ----
type Client = { userId: string; send: (event: string, data: unknown) => void };
const hubs = new Map<string, Set<Client>>();

export function subscribe(storeId: string, client: Client) {
  let set = hubs.get(storeId);
  if (!set) hubs.set(storeId, (set = new Set()));
  set.add(client);
  return () => {
    set.delete(client);
    if (set.size === 0) hubs.delete(storeId);
  };
}

/** userIds undefined = todos los conectados del local. */
export function publish(storeId: string, event: string, data: unknown = {}, userIds?: string[]) {
  for (const c of hubs.get(storeId) ?? []) {
    if (!userIds || userIds.includes(c.userId)) c.send(event, data);
  }
}

// ---- Notificaciones push (Web Push) ----
const pushEnabled = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (pushEnabled) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

export async function pushTo(userIds: string[], payload: { title: string; body: string; url?: string }) {
  if (!pushEnabled || userIds.length === 0) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, JSON.stringify(payload));
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      }
    }),
  );
}

export async function ownerIds(storeId: string) {
  const owners = await prisma.user.findMany({ where: { storeId, role: 'OWNER', active: true }, select: { id: true } });
  return owners.map((o) => o.id);
}
