export interface CountCandidate {
  id: string;
  price: number;
  perDay: number;
  /** Tuvo diferencia en un conteo anterior. */
  hadDiff: boolean;
  /** Ya se contó en los últimos días. */
  countedRecently: boolean;
}

/**
 * Elige productos para el conteo sorpresa: más probabilidad para los caros, los que más se venden
 * y los que ya tuvieron diferencias. Sin repetir los contados hace poco.
 */
export function pickCountProducts(candidates: CountCandidate[], n: number, rand: () => number = Math.random): string[] {
  const pool = candidates.filter((c) => !c.countedRecently).map((c) => ({ id: c.id, w: Math.max(1, c.price) * (c.perDay + 0.2) * (c.hadDiff ? 3 : 1) }));
  const out: string[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = rand() * total;
    const i = pool.findIndex((x) => (r -= x.w) <= 0);
    out.push(pool.splice(i < 0 ? pool.length - 1 : i, 1)[0].id);
  }
  return out;
}
