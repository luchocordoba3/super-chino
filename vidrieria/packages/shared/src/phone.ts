/**
 * Teléfonos argentinos para links de WhatsApp (wa.me necesita 54 9 + característica + número, sin 0 ni 15).
 * Devuelve null si no parece un celular válido.
 */
export function waNumber(raw: string | null | undefined): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) d = d.slice(2);
  if (d.startsWith('9') && d.length === 11) d = d.slice(1);
  if (d.startsWith('0')) d = d.slice(1);
  // Característica de 2 a 4 dígitos seguida de 15: se quita el 15 (ej. 11 15 1234-5678).
  if (d.length === 12) {
    for (const len of [2, 3, 4]) {
      if (d.slice(len, len + 2) === '15') {
        d = d.slice(0, len) + d.slice(len + 2);
        break;
      }
    }
  }
  return d.length === 10 ? '549' + d : null;
}

/** Link de WhatsApp con texto. Sin número válido, WhatsApp deja elegir el contacto. */
export function waLink(phone: string | null | undefined, text: string) {
  const n = waNumber(phone);
  return `https://wa.me/${n ?? ''}?text=${encodeURIComponent(text)}`;
}
