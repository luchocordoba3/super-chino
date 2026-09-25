import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './ui';

type Detector = { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };

export function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 1200;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.08);
    navigator.vibrate?.(60);
  } catch {
    // sin audio
  }
}

/** Lector de códigos con la cámara del celular (BarcodeDetector nativo o ZXing como respaldo). */
export function BarcodeScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const done = useRef(false);
  const cb = useRef(onDetected);
  cb.current = onDetected;

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    const found = (code: string) => {
      if (done.current) return;
      done.current = true;
      beep();
      cb.current(code);
    };
    (async () => {
      const el = video.current!;
      const BD = (window as unknown as { BarcodeDetector?: new (o: object) => Detector }).BarcodeDetector;
      if (BD) {
        const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        stop = () => stream.getTracks().forEach((tr) => tr.stop());
        if (cancelled) return stop();
        el.srcObject = stream;
        await el.play();
        const tick = async () => {
          if (cancelled || done.current) return;
          try {
            const codes = await detector.detect(el);
            if (codes[0]?.rawValue) return found(codes[0].rawValue);
          } catch {
            // cuadro sin código
          }
          setTimeout(tick, 120);
        };
        void tick();
      } else {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, el, (result) => {
          if (result) found(result.getText());
        });
        stop = () => controls.stop();
        if (cancelled) stop();
      }
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return (
    <Modal title={t('common.scan')} onClose={onClose}>
      <div className="scanner">
        <video ref={video} muted playsInline />
        <div className="frame" />
      </div>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

/** Botón 📷 que abre la cámara y devuelve el código leído. */
export function ScanButton({ onCode }: { onCode: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={t('common.scan')} aria-label={t('common.scan')}>
        📷
      </button>
      {open && (
        <BarcodeScanner
          onClose={() => setOpen(false)}
          onDetected={(code) => {
            setOpen(false);
            onCode(code);
          }}
        />
      )}
    </>
  );
}
