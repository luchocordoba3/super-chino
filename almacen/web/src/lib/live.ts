import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Escucha los avisos en vivo del servidor y refresca lo que cambió. */
export function useLiveEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource('/api/events');
    const on = (event: string, keys: string[][]) =>
      es.addEventListener(event, () => keys.forEach((queryKey) => void qc.invalidateQueries({ queryKey })));
    on('messages', [['messages'], ['unread']]);
    on('alerts', [['alerts'], ['dashboard']]);
    on('sales', [['dashboard'], ['sales'], ['products']]);
    on('attendance', [['attendance'], ['dashboard']]);
    on('stock', [['products'], ['lots'], ['product']]);
    on('catalog', [['products'], ['product']]);
    on('offers', [['offers'], ['dashboard']]);
    return () => es.close();
  }, [qc]);
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Pide permiso y registra este dispositivo para recibir notificaciones. */
export async function enablePush(vapidPublicKey: string, send: (sub: PushSubscriptionJSON) => Promise<unknown>) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('permission');
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
  await send(sub.toJSON());
}
