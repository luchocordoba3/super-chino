/** Minúsculas, sin acentos ni signos: "Puré de Tomate 520g" -> "pure de tomate 520g". */
export const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function trigrams(s: string) {
  const t = `  ${normalizeText(s)} `;
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 2; i++) {
    const g = t.slice(i, i + 3);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Parecido entre dos textos de 0 a 1 (coeficiente de Dice sobre trigramas). */
export function similarity(a: string, b: string) {
  const A = trigrams(a);
  const B = trigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

export function bestMatches<T extends { name: string }>(query: string, items: T[], n = 3, min = 0.3) {
  return items
    .map((item) => ({ item, score: similarity(query, item.name) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}
