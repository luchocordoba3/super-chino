import { api } from '../api';

export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** Registra el service worker (avisos y panel sin señal). */
export function registerSw() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const ready = () =>
  Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('El navegador no terminó de prepararse. Recargá la página.')), 8000))]);

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

function keyBytes(b64: string) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

export async function enablePush() {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Sin permiso: activalo desde los ajustes del navegador.');
  const reg = await ready();
  const { publicKey } = await api<{ publicKey: string }>('/push/key');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api('/push/subscribe', { body: sub.toJSON() });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}
