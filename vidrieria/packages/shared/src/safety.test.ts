import { describe, expect, it } from 'vitest';
import { safetyIssues } from './safety';

const item = (title: string, glass: string, riskZone?: boolean) => ({ title, riskZone, lines: [{ name: glass, applyWaste: true }, { name: 'Colocación', applyWaste: false }] });

describe('vidrio de seguridad', () => {
  it('avisa si una mampara o baranda lleva float', () => {
    expect(safetyIssues([item('Mampara corrediza', 'Float incoloro 6 mm'), item('Baranda', 'Laminado 5+5'), item('Box de ducha', 'Templado 8 mm')])).toEqual([
      { index: 0, title: 'Mampara corrediza', glass: 'Float incoloro 6 mm' },
    ]);
  });
  it('una ventana común no, salvo que esté marcada como zona de riesgo', () => {
    expect(safetyIssues([item('Cambio de vidrio', 'Float incoloro 4 mm')])).toEqual([]);
    expect(safetyIssues([item('Cambio de vidrio', 'Float incoloro 4 mm', true)])).toHaveLength(1);
  });
  it('funciona con los nombres del link público (sin applyWaste)', () => {
    expect(safetyIssues([{ title: 'Puerta de vidrio', lines: [{ name: 'Float incoloro 10 mm' }, { name: 'Bisagras' }] }])).toHaveLength(1);
  });
});
