/** Baja un archivo al celular o la compu. */
export function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const canShareFiles = (files: File[]) => typeof navigator.canShare === 'function' && navigator.canShare({ files });

/** Abre el menú de compartir del celular (WhatsApp, Drive, mail…). Devuelve false si el usuario canceló. */
export async function shareFiles(files: File[], text?: string, title?: string): Promise<boolean> {
  try {
    await navigator.share({ files, text, title });
    return true;
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return false;
    throw e;
  }
}

/** Comparte un texto: con el menú del celular si hay, si no por WhatsApp. */
export async function shareText(text: string, files: File[] = []) {
  if (files.length && canShareFiles(files)) return shareFiles(files, text);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return true;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false;
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  return true;
}
