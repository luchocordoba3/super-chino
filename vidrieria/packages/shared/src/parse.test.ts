import { describe, expect, it } from 'vitest';
import { parsePieces } from './parse';

const pick = (text: string) => parsePieces(text).map(({ source: _s, ...p }) => p);

describe('parsePieces', () => {
  it('mensaje típico con dos piezas distintas', () => {
    expect(pick('Hola, necesito 2 vidrios de 50x70 de 4mm y un espejo de 1x1.5')).toEqual([
      { kind: 'vidrio', label: 'Vidrio 4 mm', widthMm: 500, heightMm: 700, quantity: 2, thicknessMm: 4, glass: null, laminate: null },
      { kind: 'espejo', label: 'Espejo', widthMm: 1000, heightMm: 1500, quantity: 1, thicknessMm: null, glass: null, laminate: null },
    ]);
  });

  it('mampara en metros con coma y "por"', () => {
    expect(pick('mampara 1,20 por 1,80 templado 8mm')[0]).toMatchObject({ kind: 'mampara', widthMm: 1200, heightMm: 1800, glass: 'templado', thicknessMm: 8 });
  });

  it('milímetros con × y unidad explícita', () => {
    expect(pick('1200×1800 mm')[0]).toMatchObject({ kind: 'vidrio', widthMm: 1200, heightMm: 1800 });
    expect(pick('1200x1800')[0]).toMatchObject({ widthMm: 1200, heightMm: 1800 });
  });

  it('centímetros con unidad y box', () => {
    expect(pick('box de ducha 160x190 cm')[0]).toMatchObject({ kind: 'box', widthMm: 1600, heightMm: 1900, label: 'Box de ducha' });
  });

  it('laminado 3+3', () => {
    expect(pick('laminado 3+3 de 90 x 60')[0]).toMatchObject({ glass: 'laminado', laminate: '3+3', thicknessMm: 6, widthMm: 900, heightMm: 600, label: 'Vidrio laminado 3+3' });
  });

  it('cantidad en palabras', () => {
    expect(pick('tres espejos 40x60')[0]).toMatchObject({ kind: 'espejo', quantity: 3, widthMm: 400, heightMm: 600 });
  });

  it('"de 4" como espesor y "x2" como cantidad', () => {
    expect(pick('Vidrio de 4 para ventana 45x80 x2')[0]).toMatchObject({ thicknessMm: 4, quantity: 2, widthMm: 450, heightMm: 800 });
  });

  it('lista de medidas, una por renglón', () => {
    const r = pick('50x70\n60x80\n70x90');
    expect(r.map((p) => [p.widthMm, p.heightMm])).toEqual([
      [500, 700],
      [600, 800],
      [700, 900],
    ]);
  });

  it('baranda en metros', () => {
    expect(pick('baranda de escalera 3,5 x 0,9 templado 10mm')[0]).toMatchObject({ kind: 'baranda', widthMm: 3500, heightMm: 900, glass: 'templado', thicknessMm: 10 });
  });

  it('la segunda medida hereda el tipo de la anterior', () => {
    const r = pick('2 mamparas templado 8mm 120x180 y 90x180');
    expect(r[0]).toMatchObject({ kind: 'mampara', quantity: 2, widthMm: 1200 });
    expect(r[1]).toMatchObject({ kind: 'mampara', quantity: 1, widthMm: 900, glass: 'templado', thicknessMm: 8 });
  });

  it('DVH', () => {
    expect(pick('DVH 4/9/4 de 1,50 x 1,10')[0]).toMatchObject({ kind: 'dvh', widthMm: 1500, heightMm: 1100 });
  });

  it('texto sin medidas', () => {
    expect(pick('hola, ¿cómo estás? quería un presupuesto')).toEqual([]);
  });

  it('cantidad entre paréntesis y "unidades"', () => {
    expect(pick('espejo 60x90 (4)')[0]).toMatchObject({ quantity: 4 });
    expect(pick('vidrio 30x40 3 unidades')[0]).toMatchObject({ quantity: 3 });
  });
});
