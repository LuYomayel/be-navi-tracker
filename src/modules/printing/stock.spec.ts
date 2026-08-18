import {
  normColor,
  normHex,
  buildStock,
  checkStock,
  planDeduction,
  aggregateNeeds,
} from './stock';

// Rollos de prueba: el "negro" tiene dos rollos (uno casi vacio, uno lleno),
// el rojo esta agotado y el azul no trackea stock (gramsLeft null).
const filaments = [
  {
    id: 'f1',
    color: 'Negro',
    colorHex: '#000000',
    gramsLeft: 80,
    grams: 1000,
    purchasedAt: '2026-07-01',
    discarded: false,
    finishedAt: null,
    brand: 'GST3D',
    material: 'PLA+',
  },
  {
    id: 'f2',
    color: 'negro',
    colorHex: null,
    gramsLeft: 1000,
    grams: 1000,
    purchasedAt: '2026-08-01',
    discarded: false,
    finishedAt: null,
    brand: 'Grilon3',
    material: 'PLA',
  },
  {
    id: 'f3',
    color: 'Rojo',
    colorHex: '#ff0000',
    gramsLeft: 0,
    grams: 1000,
    purchasedAt: '2026-06-01',
    discarded: false,
    finishedAt: '2026-08-01',
    brand: 'Grilon3',
    material: 'PLA',
  },
  {
    id: 'f4',
    color: 'Azul',
    colorHex: null,
    gramsLeft: null,
    grams: 1000,
    purchasedAt: '2026-07-15',
    discarded: false,
    finishedAt: null,
    brand: 'Grilon3',
    material: 'PLA',
  },
  {
    id: 'f5',
    color: 'Verde',
    colorHex: '#00ae42',
    gramsLeft: 500,
    grams: 1000,
    purchasedAt: '2026-07-20',
    discarded: true,
    finishedAt: null,
    brand: 'GST3D',
    material: 'PLA+',
  },
];

describe('normColor / normHex', () => {
  it('normaliza nombre de color (trim + lower)', () => {
    expect(normColor('  Negro ')).toBe('negro');
  });

  it('normaliza hex con #, mayusculas y alpha de Bambu (RGBA de 8)', () => {
    expect(normHex('#000000')).toBe('000000');
    expect(normHex('00AE42FF')).toBe('00ae42');
    expect(normHex(null)).toBeNull();
    expect(normHex('')).toBeNull();
    expect(normHex('no-es-hex')).toBeNull();
  });
});

describe('buildStock', () => {
  it('agrupa por color y suma solo rollos activos con stock trackeado', () => {
    const stock = buildStock(filaments as any[]);
    const negro = stock.find((s) => s.color === 'negro');
    expect(negro).toBeDefined();
    expect(negro!.totalGrams).toBe(1080);
    expect(negro!.rolls).toHaveLength(2);
    // rojo agotado (finishedAt) y verde descartado no aparecen
    expect(stock.find((s) => s.color === 'rojo')).toBeUndefined();
    expect(stock.find((s) => s.color === 'verde')).toBeUndefined();
    // azul sin trackear tampoco (no hay numero para sumar)
    expect(stock.find((s) => s.color === 'azul')).toBeUndefined();
  });

  it('cuenta los rollos activos sin stock trackeado aparte', () => {
    const stock = buildStock(filaments as any[]);
    expect(stock.find((s) => s.color === 'negro')!.colorHex).toBe('000000');
  });
});

describe('aggregateNeeds', () => {
  it('suma gramos de items repetidos del mismo color', () => {
    const needs = aggregateNeeds([
      { color: 'Negro', grams: 100 },
      { color: 'negro ', grams: 50 },
      { colorHex: '#FF0000', grams: 30 },
    ]);
    expect(needs).toHaveLength(2);
    expect(needs[0].grams).toBe(150);
  });
});

describe('checkStock', () => {
  it('alcanza cuando hay stock del color', () => {
    const res = checkStock([{ color: 'Negro', grams: 500 }], filaments as any[]);
    expect(res.ok).toBe(true);
    expect(res.perColor[0]).toMatchObject({
      needed: 500,
      available: 1080,
      missing: 0,
      matched: true,
    });
  });

  it('reporta faltante cuando no alcanza', () => {
    const res = checkStock([{ color: 'negro', grams: 1200 }], filaments as any[]);
    expect(res.ok).toBe(false);
    expect(res.perColor[0].missing).toBe(120);
  });

  it('matchea por hex cuando el nombre no coincide', () => {
    const res = checkStock(
      [{ colorHex: '000000FF', grams: 100 }],
      filaments as any[],
    );
    expect(res.ok).toBe(true);
    expect(res.perColor[0].matched).toBe(true);
  });

  it('color inexistente: missing = todo lo pedido y matched false', () => {
    const res = checkStock([{ color: 'Violeta', grams: 100 }], filaments as any[]);
    expect(res.ok).toBe(false);
    expect(res.perColor[0]).toMatchObject({ available: 0, missing: 100, matched: false });
  });

  it('avisa cuantos rollos activos no trackean stock', () => {
    const res = checkStock([{ color: 'negro', grams: 10 }], filaments as any[]);
    expect(res.untrackedRolls).toBe(1); // el azul
  });
});

describe('planDeduction', () => {
  it('descuenta FIFO (rollo mas viejo primero) y cascadea al siguiente', () => {
    const { plan, unmatchedGrams } = planDeduction(
      { color: 'negro', grams: 200 },
      filaments as any[],
    );
    expect(plan).toEqual([
      { filamentId: 'f1', grams: 80 },
      { filamentId: 'f2', grams: 120 },
    ]);
    expect(unmatchedGrams).toBe(0);
  });

  it('si piden mas de lo que hay, queda unmatched', () => {
    const { plan, unmatchedGrams } = planDeduction(
      { color: 'negro', grams: 2000 },
      filaments as any[],
    );
    expect(plan).toEqual([
      { filamentId: 'f1', grams: 80 },
      { filamentId: 'f2', grams: 1000 },
    ]);
    expect(unmatchedGrams).toBe(920);
  });

  it('un filamentId explicito manda, aunque el color no coincida', () => {
    const { plan } = planDeduction(
      { filamentId: 'f2', grams: 50, color: 'lo-que-sea' },
      filaments as any[],
    );
    expect(plan).toEqual([{ filamentId: 'f2', grams: 50 }]);
  });

  it('sin match de color no planifica nada', () => {
    const { plan, unmatchedGrams } = planDeduction(
      { color: 'violeta', grams: 100 },
      filaments as any[],
    );
    expect(plan).toEqual([]);
    expect(unmatchedGrams).toBe(100);
  });
});
