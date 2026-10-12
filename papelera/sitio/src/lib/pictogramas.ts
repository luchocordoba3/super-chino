// Set de pictogramas de Doble Hoja. Grilla de 48×48, trazo de 2,2 con puntas redondas.
// Las piezas con class="a" se rellenan con el color de acento (cinta amarilla).
export const PICTOGRAMAS: Record<string, string> = {
  bolsa: `
    <path class="a" d="M14 19c-3 8-3 16 0 22h20c3-6 3-14 0-22"/>
    <path d="M14 19c-3 8-3 16 0 22h20c3-6 3-14 0-22"/>
    <path d="M14 19c3 1 6-1 10-4 4 3 7 5 10 4"/>
    <path d="M24 15l-5-7M24 15l5-7"/>
    <path d="M19 28c3 1.2 7 1.2 10 0"/>`,
  camiseta: `
    <path d="M12 18v22h24V18M12 18V8h6v6c0 3 2.5 5 6 5s6-2 6-5V8h6v10"/>
    <path class="a" d="M16 27h16v6H16z"/>`,
  bobina: `
    <circle cx="18" cy="19" r="11"/>
    <circle class="a" cx="18" cy="19" r="4"/>
    <path d="M18 30h23v10H25"/>
    <path d="M29 35h2M34 35h2"/>`,
  rollo: `
    <path d="M12 13v22M36 13v22M12 35a12 5 0 0 0 24 0"/>
    <ellipse cx="24" cy="13" rx="12" ry="5"/>
    <ellipse class="a" cx="24" cy="13" rx="4" ry="1.7"/>
    <path d="M36 22h4v14"/>`,
  bidon: `
    <path d="M12 20l5-6h14l5 6v20a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2z"/>
    <path d="M17 14V9h7v5"/>
    <path d="M28 14V9a2 2 0 0 1 2-2h2a3 3 0 0 1 3 3v10"/>
    <path class="a" d="M16 26h16v9H16z"/>`,
  botella: `
    <path d="M20 5h8v6l4 5v24a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V16l4-5z"/>
    <path d="M20 9h8"/>
    <path class="a" d="M16 22h16v10H16z"/>`,
  gatillo: `
    <path d="M17 23h14v17a2 2 0 0 1-2 2H19a2 2 0 0 1-2-2z"/>
    <path d="M20 23v-5h8v5"/>
    <path d="M18 18v-7h13l5 3v2h-5v2"/>
    <path d="M24 18l-3 6"/>
    <path class="a" d="M17 29h14v7H17z"/>`,
  aerosol: `
    <path d="M16 15h16v25a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2z"/>
    <path d="M16 15c0-3 4-5 8-5s8 2 8 5"/>
    <path d="M22 6h4v4h-4z"/>
    <circle class="p" cx="31" cy="6" r="1"/><circle class="p" cx="35" cy="4" r="1"/><circle class="p" cx="35" cy="9" r="1"/>
    <path class="a" d="M16 22h16v10H16z"/>`,
  doypack: `
    <path d="M14 9h20l2 29c0 3-5 4-12 4s-12-1-12-4z"/>
    <path d="M28 9V5h4v4"/>
    <path d="M14.4 14h19.2"/>
    <path class="a" d="M17 22h14v10H17z"/>`,
  toalla: `
    <path d="M8 22h32v18H8z"/>
    <path d="M10 22l7-6 7 6 7-6 7 6"/>
    <path d="M10 16l7-6 7 6 7-6 7 6"/>
    <rect class="a" x="14" y="28" width="20" height="5" rx="2.5"/>`,
  servilleta: `
    <path d="M8 31l16 8 16-8M8 35l16 8 16-8"/>
    <path class="a" d="M8 27l16-8 16 8-16 8z"/>
    <path d="M8 27l16-8 16 8-16 8z"/>
    <path d="M16 23l16 8"/>`,
  vaso: `
    <path class="a" d="M13.6 18h20.8l-.9 9H14.5z"/>
    <path d="M12 9h24l-3 32H15z"/>
    <path d="M10 9h28"/>`,
  bandeja: `
    <path class="a" d="M12 25h24l-3 8H15z"/>
    <path d="M6 22h36l-5 14H11z"/>
    <path d="M12 25h24l-3 8H15z"/>`,
  cubiertos: `
    <path d="M14 6v8a4 4 0 0 0 8 0V6M18 6v36"/>
    <path class="a" d="M30 6c4 3 5 10 4 18h-4z"/>
    <path d="M30 6c4 3 5 10 4 18h-4zM32 24v18"/>`,
  estuche: `
    <path class="a" d="M8 26h32v10a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z"/>
    <path d="M8 26h32v10a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z"/>
    <path d="M10 26c0-8 6-12 14-12s14 4 14 12"/>
    <path d="M5 26h38"/>`,
  escoba: `
    <path d="M24 4v26"/>
    <path class="a" d="M10 30h28v6H10z"/>
    <path d="M10 30h28v6H10z"/>
    <path d="M13 36v7M18 36v7M23 36v7M28 36v7M33 36v7"/>`,
  secador: `
    <path d="M24 4v28"/>
    <path d="M9 32h30v4H9z"/>
    <path class="a" d="M9 37h30v4H9z"/>`,
  balde: `
    <path class="a" d="M12.2 25h23.6l-.7 6H12.9z"/>
    <path d="M11 17h26l-3 24H14z"/>
    <path d="M9 17h30"/>
    <path d="M11 17c2-10 24-10 26 0"/>`,
  guante: `
    <path d="M15 35V24l-4-6a2 2 0 0 1 3.4-2l3.6 5V9a2 2 0 0 1 4 0v11V7a2 2 0 0 1 4 0v13V9a2 2 0 0 1 4 0v12V13a2 2 0 0 1 4 0v15c0 4-2 6-4 7"/>
    <path class="a" d="M15 35h15v7H15z"/>
    <path d="M15 35h15v7H15z"/>`,
  esponja: `
    <path class="a" d="M8 20h32v8H8z"/>
    <path d="M8 20h32v20H8z"/>
    <path d="M8 28h32"/>
    <circle class="p" cx="15" cy="34" r="1.2"/><circle class="p" cx="23" cy="33" r="1.2"/><circle class="p" cx="31" cy="35" r="1.2"/>`,
  trapo: `
    <path d="M34 12l4 4v26H14l-4-4"/>
    <path d="M10 12h24v26H10z"/>
    <path class="a" d="M10 17h24v4H10zM10 29h24v4H10z"/>`,
  plumero: `
    <path d="M24 28v16"/>
    <path class="a" d="M24 28c-10-2-14-10-12-20 4 4 8 6 12 6s8-2 12-6c2 10-2 18-12 20z"/>
    <path d="M24 28c-10-2-14-10-12-20 4 4 8 6 12 6s8-2 12-6c2 10-2 18-12 20z"/>
    <path d="M24 28V15M19 26l-3-11M29 26l3-11"/>`,
  pala: `
    <path class="a" d="M4 38l6-16h22v16z"/>
    <path d="M4 38l6-16h22v16z"/>
    <path d="M32 30h12"/>`,
  palo: `
    <path d="M12 42L36 6"/>
    <path class="a" d="M10.3 39.8l3.4 2.4-2.6 3.8-3.4-2.4z"/>
    <path d="M32.5 10l3.4 2.4M34.2 7.4l3.4 2.4"/>`,
  mopa: `
    <path d="M24 4v22"/>
    <path class="a" d="M15 26h18v4H15z"/>
    <path d="M15 26h18v4H15z"/>
    <path d="M17 30c-2 6-1 10 0 13M21 30c-1 6 0 10 0 13M25 30c0 6 1 10 1 13M29 30c1 5 2 9 3 12"/>`,
  cinta: `
    <circle class="a" cx="22" cy="20" r="14"/>
    <circle cx="22" cy="20" r="14"/>
    <circle class="f" cx="22" cy="20" r="6"/>
    <path d="M22 34h19v-4"/>`,
  film: `
    <path class="a" d="M5 18h38v4H5z"/>
    <path d="M5 18h38v12H5z"/>
    <path d="M5 30l3 3 3-3 3 3 3-3 3 3 3-3 3 3 3-3 3 3 3-3 3 3 3-3 2 2"/>
    <circle cx="10" cy="24" r="2.5"/>`,
  resma: `
    <path d="M6 20l18-8 18 8-18 8z"/>
    <path d="M6 20v9l18 8 18-8v-9"/>
    <path class="a" d="M6 24l18 8 18-8v2.5l-18 8-18-8z"/>`,
  caja: `
    <path d="M8 15l16-7 16 7v19l-16 7-16-7z"/>
    <path d="M8 15l16 7 16-7M24 22v19"/>
    <path class="a" d="M14.5 12.2l3-1.4 16 7v19l-3 1.4v-19z"/>`,
  papel: `
    <path class="a" d="M29 5v9h9z"/>
    <path d="M12 5h17l9 9v29H12z"/>
    <path d="M29 5v9h9"/>
    <path d="M17 22h16M17 28h16M17 34h10"/>`,
  pan: `
    <path class="a" d="M8 25c0-3 2-5 5-5h22c3 0 5 2 5 5v9c0 3-2 5-5 5H13c-3 0-5-2-5-5z"/>
    <path d="M8 25c0-3 2-5 5-5h22c3 0 5 2 5 5v9c0 3-2 5-5 5H13c-3 0-5-2-5-5z"/>
    <circle cx="15" cy="11" r="3"/><circle cx="23" cy="8" r="2"/><circle cx="22" cy="14" r="1.5"/>`,
  // Negocios (asistente de kits)
  verdura: `
    <path class="a" d="M24 17c-4-3-12-2-13 6-1 7 3 16 8 18 2 1 3 0 5-1 2 1 3 2 5 1 5-2 9-11 8-18-1-8-9-9-13-6z"/>
    <path d="M24 17c-4-3-12-2-13 6-1 7 3 16 8 18 2 1 3 0 5-1 2 1 3 2 5 1 5-2 9-11 8-18-1-8-9-9-13-6z"/>
    <path d="M24 17c0-4 1-7 3-10"/>
    <path d="M26 12c2-4 7-5 10-4-1 4-5 6-10 4z"/>`,
  carne: `
    <path class="a" d="M6 13h25v14a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z"/>
    <path d="M6 13h25v14a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z"/>
    <path d="M31 18h9a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-9"/>
    <circle class="f" cx="11.5" cy="18.5" r="2"/>
    <path d="M10 37h20"/>`,
  pizza: `
    <path class="a" d="M24 42L10 14c9-4 19-4 28 0z"/>
    <path d="M24 42L10 14c9-4 19-4 28 0z"/>
    <path d="M8 10c10-5 22-5 32 0l-2 4c-9-4-19-4-28 0z"/>
    <circle class="f" cx="20" cy="21" r="2.4"/><circle class="f" cx="28.5" cy="24" r="2.4"/><circle class="f" cx="23.5" cy="31" r="2"/>`,
  olla: `
    <path class="a" d="M10 23h28v12a5 5 0 0 1-5 5H15a5 5 0 0 1-5-5z"/>
    <path d="M10 23h28v12a5 5 0 0 1-5 5H15a5 5 0 0 1-5-5z"/>
    <path d="M7 23h34M10 27H5M38 27h5"/>
    <path d="M14 23c0-4 4-6 10-6s10 2 10 6M22 17v-2h4v2"/>
    <path d="M18 11c-1-2 1-3 0-5M24 11c-1-2 1-3 0-5M30 11c-1-2 1-3 0-5"/>`,
  helado: `
    <path d="M15 22h18l-9 21z"/>
    <path d="M19 27l9 7M17.5 25l2 2M22 33l4-6"/>
    <path class="a" d="M16.6 22A9 9 0 1 1 31.4 22z"/>
    <path d="M16.6 22A9 9 0 1 1 31.4 22z"/>`,
  taza: `
    <path class="a" d="M9 19h23v10a8 8 0 0 1-8 8h-7a8 8 0 0 1-8-8z"/>
    <path d="M9 19h23v10a8 8 0 0 1-8 8h-7a8 8 0 0 1-8-8z"/>
    <path d="M32 22h3a4.5 4.5 0 0 1 0 9h-3.6"/>
    <path d="M6 42h29"/>
    <path d="M16 14c-1-2 1-3 0-5M22 14c-1-2 1-3 0-5M28 14c-1-2 1-3 0-5"/>`,
  toldo: `
    <path d="M9 21v20h30V21M5 41h38"/>
    <path class="a" d="M6 11h36l-2 9H8z"/>
    <path d="M6 11h36M8 20a4 4 0 0 0 8 0 4 4 0 0 0 8 0 4 4 0 0 0 8 0 4 4 0 0 0 8 0M6 11l2 9M42 11l-2 9M16 11v9M24 11v9M32 11v9"/>
    <path d="M14 41V30h8v11M27 29h8v6h-8z"/>`,
  edificio: `
    <path d="M12 42V7h24v35M6 42h36"/>
    <path class="a" d="M20 34h8v8h-8z"/>
    <path d="M20 42v-8h8v8"/>
    <path d="M17 13h4v3h-4zM27 13h4v3h-4zM17 20h4v3h-4zM27 20h4v3h-4zM17 27h4v3h-4zM27 27h4v3h-4z"/>`,
  maletin: `
    <path class="a" d="M7 24h34v6H7z"/>
    <rect x="7" y="15" width="34" height="25" rx="3"/>
    <path d="M18 15v-3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M7 27h34"/>
    <path class="f" d="M21 24h6v6h-6z"/>`,
  pesa: `
    <path d="M15 24h18M5 21v6M43 21v6"/>
    <rect class="a" x="8" y="13" width="7" height="22" rx="2"/>
    <rect x="8" y="13" width="7" height="22" rx="2"/>
    <rect class="a" x="33" y="13" width="7" height="22" rx="2"/>
    <rect x="33" y="13" width="7" height="22" rx="2"/>`,
};

export function svgPictograma(nombre: string, clase = "pictograma"): string {
  const cuerpo = PICTOGRAMAS[nombre] ?? PICTOGRAMAS.caja;
  return `<svg class="${clase}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${cuerpo}</svg>`;
}
