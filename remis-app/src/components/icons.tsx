// Íconos de línea (24×24). Varias figuras por trazo: cada "M" empieza una nueva.
const PATHS = {
  home: 'M3 11l9-8 9 8M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  car: 'M5 11l1.6-4.4A2 2 0 0 1 8.5 5.3h7a2 2 0 0 1 1.9 1.3L19 11M4 11h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM6 17v2M18 17v2M7 14h.01M17 14h.01',
  chart: 'M4 20V11M10 20V5M16 20v-6M21 20H3',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  fuel: 'M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h13M7 8h5M15 10h2a2 2 0 0 1 2 2v4.5a1.5 1.5 0 0 0 3 0V8.5L19 5',
  toll: 'M5 21V5M2.5 21h5M5 8.5h16v4H5M10 8.5l-3 4M15 8.5l-3 4M20 8.5l-3 4',
  receipt: 'M5 2.5h14v19l-2.5-1.8-2.3 1.8-2.2-1.8-2.2 1.8-2.3-1.8L5 21.5zM9 7.5h6M9 11.5h6M9 15.5h3.5',
  cash: 'M2.5 6.5h19v11h-19zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 12h.01M18 12h.01',
  play: 'M7 4.5l12 7.5-12 7.5z',
  stop: 'M6.5 6.5h11v11h-11z',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z',
  doc: 'M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8zM14 2.5V8h5.5M8.5 13h7M8.5 17h7',
  check: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  crash: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  camera: 'M22 18.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h3.5l2-3h5l2 3H20a2 2 0 0 1 2 2zM12 17a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6z',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6L6 18M6 6l12 12',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  calendar: 'M3.5 5h17v16h-17zM16 3v4M8 3v4M3.5 10h17',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  swap: 'M16 3l4 4-4 4M20 7H8M8 21l-4-4 4-4M4 17h12',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'icon' }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
