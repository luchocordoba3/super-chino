// Dibujo de códigos de barras EAN-13 (y EAN-8) en SVG para las etiquetas de góndola.

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Dígito verificador EAN (sirve para EAN-8 y EAN-13). */
function checkDigit(body: string) {
  const sum = [...body].reverse().reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

/** Módulos (1 = barra) de un EAN-13 o EAN-8 válido; null si el código no es EAN. */
export function eanModules(code: string): string | null {
  if (!/^\d{8}$|^\d{13}$/.test(code)) return null;
  if (checkDigit(code.slice(0, -1)) !== Number(code.at(-1))) return null;
  if (code.length === 8) {
    return '101' + [...code.slice(0, 4)].map((d) => L[+d]).join('') + '01010' + [...code.slice(4)].map((d) => R[+d]).join('') + '101';
  }
  const parity = PARITY[+code[0]];
  const left = [...code.slice(1, 7)].map((d, i) => (parity[i] === 'L' ? L : G)[+d]).join('');
  const right = [...code.slice(7)].map((d) => R[+d]).join('');
  return '101' + left + '01010' + right + '101';
}

/** Path SVG con las barras (1 unidad = 1 módulo). */
export function eanPath(modules: string) {
  let d = '';
  for (let i = 0; i < modules.length; i++) if (modules[i] === '1') d += `M${i} 0h1v1h-1z`;
  return d;
}
