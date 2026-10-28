import {
  countBuildable,
  planConsumption,
  stockFromMoves,
  RecipeLine,
} from './parts';

// Carrot simplificado: tablero marron fijo + zanahoria (cuerpo naranja fijo x2)
// + 3 slots de colores distintos {punta, cara}.
const carrot: RecipeLine[] = [
  { partId: 'tablero', qty: 1, colorMode: 'fijo', fixedColor: 'marrón' },
  { partId: 'cuerpo', qty: 2, colorMode: 'fijo', fixedColor: 'naranja' },
  ...['s1', 's2', 's3'].flatMap((slot) => [
    {
      partId: 'punta',
      qty: 1,
      colorMode: 'distintos' as const,
      group: 'colores',
      slot,
    },
    {
      partId: 'cara',
      qty: 1,
      colorMode: 'distintos' as const,
      group: 'colores',
      slot,
    },
  ]),
];

const stock = (entries: [string, string, number][]) =>
  stockFromMoves(
    entries.map(([partId, color, qty]) => ({ partId, color, qty })),
  );

describe('stockFromMoves', () => {
  it('suma los movimientos por pieza y color', () => {
    const s = stockFromMoves([
      { partId: 'punta', color: 'rojo', qty: 4 },
      { partId: 'punta', color: 'rojo', qty: -1 },
      { partId: 'punta', color: 'azul', qty: 2 },
    ]);
    expect(s.get('punta|rojo')).toBe(3);
    expect(s.get('punta|azul')).toBe(2);
  });
});

describe('countBuildable', () => {
  it('cuenta unidades respetando fijos y colores distintos', () => {
    const s = stock([
      ['tablero', 'marrón', 5],
      ['cuerpo', 'naranja', 10],
      ['punta', 'rojo', 2],
      ['cara', 'rojo', 2],
      ['punta', 'azul', 2],
      ['cara', 'azul', 2],
      ['punta', 'blanco', 2],
      ['cara', 'blanco', 2],
    ]);
    expect(countBuildable(carrot, s).buildable).toBe(2);
  });

  it('una punta sin su cara del mismo color no sirve (caras = colores de las puntas)', () => {
    const s = stock([
      ['tablero', 'marrón', 1],
      ['cuerpo', 'naranja', 2],
      ['punta', 'rojo', 1],
      ['cara', 'rojo', 1],
      ['punta', 'azul', 1],
      ['cara', 'azul', 1],
      ['punta', 'blanco', 1],
      ['cara', 'rosa', 1],
    ]);
    const res = countBuildable(carrot, s);
    expect(res.buildable).toBe(0);
    expect(res.missing.join(' ')).toMatch(/colores/);
  });

  it('16 puntas de 4 colores no alcanzan para 6 colores distintos', () => {
    const six: RecipeLine[] = ['s1', 's2', 's3', 's4', 's5', 's6'].map(
      (slot) => ({
        partId: 'punta',
        qty: 1,
        colorMode: 'distintos',
        group: 'colores',
        slot,
      }),
    );
    const s = stock(
      ['rojo', 'blanco', 'amarillo', 'rosa'].map(
        (c) => ['punta', c, 4] as [string, string, number],
      ),
    );
    const res = countBuildable(six, s);
    expect(res.buildable).toBe(0);
    expect(res.missing[0]).toMatch(/4 de 6/);
  });

  it('juego: toda la estructura del mismo color (no mezcla balanza negra con base blanca)', () => {
    const tetris: RecipeLine[] = [
      { partId: 'balanza', qty: 1, colorMode: 'juego', group: 'estructura' },
      { partId: 'base', qty: 1, colorMode: 'juego', group: 'estructura' },
    ];
    expect(
      countBuildable(
        tetris,
        stock([
          ['balanza', 'negro', 1],
          ['base', 'blanco', 1],
        ]),
      ).buildable,
    ).toBe(0);
    expect(
      countBuildable(
        tetris,
        stock([
          ['balanza', 'negro', 1],
          ['base', 'negro', 1],
          ['balanza', 'blanco', 1],
          ['base', 'blanco', 1],
        ]),
      ).buildable,
    ).toBe(2);
  });

  it('libre: cualquier color, puede mezclar', () => {
    const soporte: RecipeLine[] = [
      { partId: 'soporte', qty: 1, colorMode: 'libre' },
    ];
    expect(
      countBuildable(
        soporte,
        stock([
          ['soporte', 'rosa', 2],
          ['soporte', 'negro', 1],
        ]),
      ).buildable,
    ).toBe(3);
  });

  it('sin receta no se puede armar nada', () => {
    expect(countBuildable([], stock([])).buildable).toBe(0);
  });
});

describe('planConsumption', () => {
  it('arma N unidades y devuelve que piezas de que color consume', () => {
    const s = stock([
      ['tablero', 'marrón', 1],
      ['cuerpo', 'naranja', 2],
      ['punta', 'rojo', 1],
      ['cara', 'rojo', 1],
      ['punta', 'azul', 1],
      ['cara', 'azul', 1],
      ['punta', 'blanco', 1],
      ['cara', 'blanco', 1],
    ]);
    const res = planConsumption(carrot, s, 1);
    expect(res.built).toBe(1);
    expect(res.shortfall).toEqual([]);
    const byKey = Object.fromEntries(
      res.moves.map((m) => [`${m.partId}|${m.color}`, m.qty]),
    );
    expect(byKey).toEqual({
      'tablero|marrón': 1,
      'cuerpo|naranja': 2,
      'punta|rojo': 1,
      'cara|rojo': 1,
      'punta|azul': 1,
      'cara|azul': 1,
      'punta|blanco': 1,
      'cara|blanco': 1,
    });
  });

  it('respeta el color pedido para el juego', () => {
    const tetris: RecipeLine[] = [
      { partId: 'balanza', qty: 1, colorMode: 'juego', group: 'estructura' },
    ];
    const s = stock([
      ['balanza', 'negro', 3],
      ['balanza', 'blanco', 1],
    ]);
    const res = planConsumption(tetris, s, 1, {
      groupColors: { estructura: 'blanco' },
    });
    expect(res.moves).toEqual([{ partId: 'balanza', color: 'blanco', qty: 1 }]);
  });

  it('un color de juego por defecto aplica a cualquier grupo juego', () => {
    const tetris: RecipeLine[] = [
      { partId: 'balanza', qty: 1, colorMode: 'juego', group: 'estructura' },
    ];
    const s = stock([['balanza', 'negro', 3], ['balanza', 'blanco', 1]]);
    const res = planConsumption(tetris, s, 1, { anyGroupColor: 'blanco' });
    expect(res.moves).toEqual([{ partId: 'balanza', color: 'blanco', qty: 1 }]);
  });

  it('si no alcanza, informa lo que falta para las unidades que no se pudieron armar', () => {
    const s = stock([['tablero', 'marrón', 0]]);
    const res = planConsumption(carrot, s, 2);
    expect(res.built).toBe(0);
    expect(res.shortfall.length).toBeGreaterThan(0);
  });
});
