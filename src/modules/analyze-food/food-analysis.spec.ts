import {
  buildFoodAnalysis,
  FoodAnalysisError,
  RawFoodAnalysis,
  RawFoodItem,
} from './food-analysis';

const item = (over: Partial<RawFoodItem> = {}): RawFoodItem => ({
  name: 'Arroz blanco cocido',
  quantity: '1 taza',
  grams: 150,
  category: 'carbs',
  certainty: 'alta',
  per100g: {
    calories: 130,
    protein: 2.7,
    carbs: 28,
    fat: 0.3,
    fiber: 0.4,
    sugar: 0.1,
    sodium: 1,
  },
  ...over,
});

const raw = (items: RawFoodItem[], assumptions: string[] = []): RawFoodAnalysis => ({
  foods: items,
  assumptions,
});

describe('buildFoodAnalysis', () => {
  it('calcula calorias y macros en codigo a partir de gramos x valores por 100 g', () => {
    const r = buildFoodAnalysis(raw([item()]), 'lunch');

    expect(r.foods).toHaveLength(1);
    expect(r.foods[0].calories).toBe(195); // 130 * 1.5
    expect(r.foods[0].macronutrients.carbs).toBe(42); // 28 * 1.5
    expect(r.foods[0].macronutrients.protein).toBe(4.1); // 2.7 * 1.5 = 4.05
    expect(r.foods[0].grams).toBe(150);
    expect(r.foods[0].per100g.calories).toBe(130);
    expect(r.mealType).toBe('lunch');
  });

  it('los totales son la suma exacta de los alimentos', () => {
    const r = buildFoodAnalysis(
      raw([
        item(),
        item({
          name: 'Pechuga de pollo a la plancha',
          grams: 200,
          category: 'protein',
          per100g: {
            calories: 165,
            protein: 31,
            carbs: 0,
            fat: 3.6,
            fiber: 0,
            sugar: 0,
            sodium: 74,
          },
        }),
      ]),
      'lunch',
    );

    expect(r.totalCalories).toBe(195 + 330);
    expect(r.macronutrients.protein).toBe(66.1); // 4.1 + 62
    expect(r.macronutrients.sodium).toBe(150); // 2 + 148
  });

  it('multiplica los gramos por las porciones comidas', () => {
    const r = buildFoodAnalysis(raw([item()]), 'lunch', 2);

    expect(r.foods[0].grams).toBe(300);
    expect(r.foods[0].calories).toBe(390);
    expect(r.totalCalories).toBe(390);
  });

  it('NO inventa valores: descarta alimentos sin gramos o sin datos nutricionales', () => {
    const r = buildFoodAnalysis(
      raw([
        item(),
        item({ name: 'Sin gramos', grams: 0 }),
        item({ name: 'Sin datos', per100g: undefined as any }),
        item({ name: 'Calorias invalidas', per100g: { ...item().per100g, calories: NaN } }),
      ]),
      'lunch',
    );

    expect(r.foods.map((f) => f.name)).toEqual(['Arroz blanco cocido']);
  });

  it('falla (no devuelve un plato falso) si no queda ningun alimento valido', () => {
    expect(() => buildFoodAnalysis(raw([]), 'lunch')).toThrow(FoodAnalysisError);
    expect(() =>
      buildFoodAnalysis(raw([item({ grams: 0 })]), 'lunch'),
    ).toThrow(FoodAnalysisError);
    expect(() => buildFoodAnalysis({} as any, 'lunch')).toThrow(FoodAnalysisError);
  });

  it('corrige calorias incoherentes con los macros (regla 4/4/9)', () => {
    // 31g prot + 3.6g grasa = ~156 kcal; el modelo dijo 60 → incoherente
    const r = buildFoodAnalysis(
      raw([
        item({
          name: 'Pollo',
          category: 'protein',
          grams: 100,
          per100g: { calories: 60, protein: 31, carbs: 0, fat: 3.6, fiber: 0, sugar: 0, sodium: 0 },
        }),
      ]),
      'lunch',
    );
    expect(r.foods[0].calories).toBe(156);
  });

  it('no toca las calorias de bebidas (el alcohol aporta kcal fuera de los macros)', () => {
    const r = buildFoodAnalysis(
      raw([
        item({
          name: 'Cerveza',
          category: 'beverages',
          grams: 500,
          per100g: { calories: 43, protein: 0.5, carbs: 3.6, fat: 0, fiber: 0, sugar: 0, sodium: 4 },
        }),
      ]),
      'dinner',
    );
    expect(r.foods[0].calories).toBe(215);
  });

  it('respeta calorias coherentes aunque no sean exactamente 4/4/9', () => {
    const r = buildFoodAnalysis(raw([item()]), 'lunch');
    // Atwater daria 125.5/100g; 130 esta dentro de la tolerancia → queda 130
    expect(r.foods[0].per100g.calories).toBe(130);
  });

  it('la confianza sale de la certeza por alimento, ponderada por calorias', () => {
    const alta = buildFoodAnalysis(raw([item({ certainty: 'alta' })]), 'lunch');
    const baja = buildFoodAnalysis(raw([item({ certainty: 'baja' })]), 'lunch');
    expect(alta.confidence).toBe(0.9);
    expect(baja.confidence).toBe(0.45);
    expect(alta.foods[0].confidence).toBe(0.9);

    // Un alimento chico y dudoso casi no mueve la confianza del plato
    const mixto = buildFoodAnalysis(
      raw([
        item({ certainty: 'alta', grams: 300 }),
        item({ name: 'Perejil', certainty: 'baja', grams: 2 }),
      ]),
      'lunch',
    );
    expect(mixto.confidence).toBeGreaterThan(0.85);
  });

  it('normaliza categorias desconocidas a "other" y limpia los supuestos', () => {
    const r = buildFoodAnalysis(
      raw([item({ category: 'grains' })], ['  Asumí 1 cda de aceite  ', '', 'x'.repeat(400)]),
      'lunch',
    );
    expect(r.foods[0].category).toBe('other');
    expect(r.assumptions).toHaveLength(2);
    expect(r.assumptions[0]).toBe('Asumí 1 cda de aceite');
    expect(r.assumptions[1].length).toBeLessThanOrEqual(200);
  });

  it('recorta valores absurdos por 100 g en vez de propagarlos', () => {
    const r = buildFoodAnalysis(
      raw([
        item({
          name: 'Aceite',
          category: 'fats',
          grams: 10,
          per100g: { calories: 5000, protein: 0, carbs: 0, fat: 100, fiber: 0, sugar: 0, sodium: 0 },
        }),
      ]),
      'lunch',
    );
    // 100 g de cualquier alimento no pasan de ~900 kcal
    expect(r.foods[0].calories).toBe(90);
  });
});
