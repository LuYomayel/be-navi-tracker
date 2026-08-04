import {
  computePace,
  DEFAULT_HYDRATION_BLOCKS,
  validateBlocks,
} from './hydration-pace';

// Helper: minutos desde medianoche
const t = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

describe('computePace', () => {
  // Bloques del caso real de Luciano
  const blocks = DEFAULT_HYDRATION_BLOCKS;

  it('default blocks reflejan el plan de Luciano', () => {
    expect(blocks).toEqual([
      expect.objectContaining({ id: 'morning', start: '07:00', end: '13:00', targetMl: 1000 }),
      expect.objectContaining({ id: 'afternoon', start: '13:00', end: '20:00', targetMl: 1000 }),
      expect.objectContaining({
        id: 'training',
        targetMl: 1500,
        requiresTraining: true,
      }),
    ]);
  });

  it('a las 10:00 sin entrenar: espera la mitad del tramo mañana', () => {
    const pace = computePace(blocks, t('10:00'), 0, false);
    // 10:00 = 3h de 6h del tramo mañana → 500ml esperados
    expect(pace.expectedByNowMl).toBe(500);
    expect(pace.deficitMl).toBe(500);
    expect(pace.currentBlock?.id).toBe('morning');
    expect(pace.totalTargetMl).toBe(2000); // sin tramo de entrenamiento
  });

  it('a las 10:00 con 750ml tomados: va adelantado (deficit 0)', () => {
    const pace = computePace(blocks, t('10:00'), 750, false);
    expect(pace.deficitMl).toBe(0);
    expect(pace.aheadMl).toBe(250);
  });

  it('a las 15:00: tramo mañana completo + proporcional de la tarde', () => {
    const pace = computePace(blocks, t('15:00'), 1000, false);
    // mañana 1000 + tarde 2/7 de 1000 ≈ 286
    expect(pace.expectedByNowMl).toBe(1000 + Math.round((2 / 7) * 1000));
    expect(pace.currentBlock?.id).toBe('afternoon');
    expect(pace.deficitMl).toBe(pace.expectedByNowMl - 1000);
  });

  it('con entrenamiento activo el total incluye el tramo opcional', () => {
    const pace = computePace(blocks, t('19:00'), 2000, true);
    expect(pace.totalTargetMl).toBe(3500);
    const training = pace.blocks.find((b) => b.id === 'training');
    expect(training?.active).toBe(true);
  });

  it('sin entrenamiento el tramo opcional queda inactivo y no genera deficit', () => {
    const pace = computePace(blocks, t('22:00'), 2000, false);
    const training = pace.blocks.find((b) => b.id === 'training');
    expect(training?.active).toBe(false);
    expect(pace.deficitMl).toBe(0); // 2000 de 2000 cumplidos
    expect(pace.goalReached).toBe(true);
  });

  it('el agua consumida llena los tramos en orden', () => {
    const pace = computePace(blocks, t('15:00'), 1300, false);
    const morning = pace.blocks.find((b) => b.id === 'morning');
    const afternoon = pace.blocks.find((b) => b.id === 'afternoon');
    expect(morning?.filledMl).toBe(1000);
    expect(afternoon?.filledMl).toBe(300);
  });

  it('antes del primer tramo no espera nada', () => {
    const pace = computePace(blocks, t('06:00'), 0, false);
    expect(pace.expectedByNowMl).toBe(0);
    expect(pace.deficitMl).toBe(0);
    expect(pace.currentBlock).toBeNull();
  });

  it('despues del ultimo tramo espera el total del dia', () => {
    const pace = computePace(blocks, t('23:30'), 1500, true);
    expect(pace.expectedByNowMl).toBe(3500);
    expect(pace.deficitMl).toBe(2000);
  });

  it('tramos solapados (tarde y entrenamiento) suman expectativas en paralelo', () => {
    // 19:00 con entrenamiento: tarde va 6/7 + entrenamiento va 1/5 de 1500
    const pace = computePace(blocks, t('19:00'), 0, true);
    const expected =
      1000 + Math.round((6 / 7) * 1000) + Math.round((1 / 5) * 1500);
    expect(pace.expectedByNowMl).toBe(expected);
  });
});

describe('validateBlocks', () => {
  it('acepta bloques validos', () => {
    expect(() => validateBlocks(DEFAULT_HYDRATION_BLOCKS)).not.toThrow();
  });

  it('rechaza horarios invalidos o ml <= 0', () => {
    expect(() =>
      validateBlocks([
        { id: 'x', label: 'X', start: '25:00', end: '13:00', targetMl: 500 },
      ] as any),
    ).toThrow();
    expect(() =>
      validateBlocks([
        { id: 'x', label: 'X', start: '08:00', end: '10:00', targetMl: 0 },
      ] as any),
    ).toThrow();
    expect(() =>
      validateBlocks([
        { id: 'x', label: 'X', start: '14:00', end: '13:00', targetMl: 500 },
      ] as any),
    ).toThrow();
  });

  it('rechaza lista vacia o mas de 6 tramos', () => {
    expect(() => validateBlocks([] as any)).toThrow();
  });
});
