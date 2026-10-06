/**
 * Vidrio de seguridad (norma IRAM 12595 y, en CABA, Ley 6438): en mamparas, box de ducha, barandas, escaleras,
 * puertas, paños bajos y techos va templado o laminado. Si el presupuesto lleva vidrio común ahí, se avisa.
 */
const RISKY_WORK = /mampara|box|ducha|baranda|escalera|puerta|techo|marquesina|cerramiento de balc/i;
const GLASS = /float|templad|laminad|vidrio|cristal|espejo|dvh|incoloro|esmerilad|arenad/i;
const SAFE = /templad|laminad|\d\s*\+\s*\d|seguridad/i;

export interface SafetyIssue {
  index: number;
  title: string;
  glass: string;
}

/** Trabajos que llevan vidrio común donde corresponde vidrio de seguridad. */
export function safetyIssues(items: { title: string; riskZone?: boolean; lines: { name: string; applyWaste?: boolean }[] }[]): SafetyIssue[] {
  return items.flatMap((it, index) => {
    if (!RISKY_WORK.test(it.title) && !it.riskZone) return [];
    const glass = it.lines.find((l) => l.applyWaste ?? GLASS.test(l.name));
    if (!glass || SAFE.test(glass.name) || /espejo/i.test(glass.name)) return [];
    return [{ index, title: it.title, glass: glass.name }];
  });
}
