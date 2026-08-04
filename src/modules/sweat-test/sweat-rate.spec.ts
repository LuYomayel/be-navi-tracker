import {
  computeSweatTest,
  recommendDailyIntake,
  DEHYDRATION_LEVELS,
} from './sweat-rate';

describe('computeSweatTest', () => {
  it('calcula el sudor con la formula (peso antes - peso despues) + liquido tomado', () => {
    // Ejemplo de la nota [4/8]: 80,0 -> 78,6 kg tomando 500ml = 1,9 L
    const r = computeSweatTest({
      weightBeforeKg: 80,
      weightAfterKg: 78.6,
      fluidIntakeMl: 500,
      durationMin: 120,
    });
    expect(r.sweatMl).toBe(1900);
    expect(r.sweatRateMlPerHour).toBe(950);
  });

  it('descuenta la orina del test cuando se registra', () => {
    const r = computeSweatTest({
      weightBeforeKg: 80,
      weightAfterKg: 78.6,
      fluidIntakeMl: 500,
      urineMl: 300,
      durationMin: 120,
    });
    expect(r.sweatMl).toBe(1600); // 1400 + 500 - 300
  });

  it('el deficit neto es lo perdido menos lo repuesto, en % del peso corporal', () => {
    const r = computeSweatTest({
      weightBeforeKg: 82,
      weightAfterKg: 80.5,
      fluidIntakeMl: 700,
      durationMin: 120,
    });
    expect(r.netDeficitMl).toBe(1500); // los kg que efectivamente perdio
    expect(r.pctBodyWeightLost).toBeCloseTo(1.83, 2);
  });

  it('clasifica el deficit segun los umbrales (2% = caida medible de rendimiento)', () => {
    const leve = computeSweatTest({
      weightBeforeKg: 82,
      weightAfterKg: 81.5,
      fluidIntakeMl: 0,
      durationMin: 60,
    });
    expect(leve.level).toBe('ok'); // 0,61%

    const sed = computeSweatTest({
      weightBeforeKg: 82,
      weightAfterKg: 80.9,
      fluidIntakeMl: 0,
      durationMin: 60,
    });
    expect(sed.level).toBe('sed'); // 1,34%

    const caida = computeSweatTest({
      weightBeforeKg: 82,
      weightAfterKg: 80,
      fluidIntakeMl: 0,
      durationMin: 120,
    });
    expect(caida.level).toBe('rendimiento'); // 2,44%

    const fuerza = computeSweatTest({
      weightBeforeKg: 82,
      weightAfterKg: 79,
      fluidIntakeMl: 0,
      durationMin: 120,
    });
    expect(fuerza.level).toBe('fuerza'); // 3,66%

    const critico = computeSweatTest({
      weightBeforeKg: 82,
      weightAfterKg: 77.5,
      fluidIntakeMl: 0,
      durationMin: 120,
    });
    expect(critico.level).toBe('critico'); // 5,49%
  });

  it('cada nivel tiene su descripcion para mostrar en la app', () => {
    expect(Object.keys(DEHYDRATION_LEVELS)).toEqual([
      'ok',
      'sed',
      'rendimiento',
      'fuerza',
      'critico',
    ]);
    expect(DEHYDRATION_LEVELS.rendimiento.label).toMatch(/rendimiento/i);
  });

  it('rechaza datos imposibles', () => {
    expect(() =>
      computeSweatTest({
        weightBeforeKg: 78,
        weightAfterKg: 80,
        fluidIntakeMl: 0,
        durationMin: 60,
      }),
    ).toThrow(/peso/i);
    expect(() =>
      computeSweatTest({
        weightBeforeKg: 82,
        weightAfterKg: 81,
        fluidIntakeMl: 0,
        durationMin: 0,
      }),
    ).toThrow(/duraci/i);
  });

  it('recomienda cuanto reponer despues (125-150% de lo perdido)', () => {
    const r = computeSweatTest({
      weightBeforeKg: 82,
      weightAfterKg: 80.5,
      fluidIntakeMl: 700,
      durationMin: 120,
    });
    expect(r.rehydrateMl).toBe(1950); // 1500 * 1.3
  });
});

describe('recommendDailyIntake', () => {
  it('calcula la necesidad de un dia de entrenamiento con la formula de la nota [5/8]', () => {
    // 82 kg, 2 hs, tasa medida 1100 ml/h, con creatina
    const r = recommendDailyIntake({
      weightKg: 82,
      sweatRateMlPerHour: 1100,
      trainingHours: 2,
      creatine: true,
    });
    expect(r.baseMl).toBe(2870); // 82 * 35
    expect(r.trainingMl).toBe(2860); // 2200 perdidos * 1.3
    expect(r.creatineMl).toBe(400);
    expect(r.totalMl).toBe(6130);
    expect(r.drinkMl).toBe(4781); // menos 22% de comida y metabolismo
    expect(r.glasses).toBe(19);
  });

  it('un dia sin entrenar solo suma base y creatina', () => {
    const r = recommendDailyIntake({
      weightKg: 82,
      sweatRateMlPerHour: 1100,
      trainingHours: 0,
      creatine: true,
    });
    expect(r.trainingMl).toBe(0);
    expect(r.drinkMl).toBe(2551);
    expect(r.glasses).toBe(10);
  });

  it('sin creatina no suma el extra', () => {
    const r = recommendDailyIntake({
      weightKg: 82,
      sweatRateMlPerHour: 1000,
      trainingHours: 0,
      creatine: false,
    });
    expect(r.creatineMl).toBe(0);
  });

  it('usa una tasa por defecto conservadora si todavia no hay test medido', () => {
    const r = recommendDailyIntake({
      weightKg: 82,
      trainingHours: 2,
      creatine: true,
    });
    expect(r.estimated).toBe(true);
    expect(r.sweatRateMlPerHour).toBe(1000);
  });

  it('marca estimated=false cuando la tasa viene de un test real', () => {
    const r = recommendDailyIntake({
      weightKg: 82,
      sweatRateMlPerHour: 1250,
      trainingHours: 2,
      creatine: true,
    });
    expect(r.estimated).toBe(false);
  });

  it('convierte la recomendacion a tramos de hidratacion listos para usar', () => {
    const r = recommendDailyIntake({
      weightKg: 82,
      sweatRateMlPerHour: 1100,
      trainingHours: 2,
      creatine: true,
    });
    const total = r.suggestedBlocks.reduce((acc, b) => acc + b.targetMl, 0);
    // Los tramos van en multiplos de 50 (numeros usables), asi que la suma
    // puede quedar hasta 50ml del calculo exacto.
    expect(Math.abs(total - r.drinkMl)).toBeLessThanOrEqual(50);
    expect(r.suggestedBlocks.every((b) => b.targetMl % 50 === 0)).toBe(true);
    expect(r.suggestedBlocks.some((b) => b.requiresTraining)).toBe(true);
  });
});
