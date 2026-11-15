/**
 * Logica PURA del analisis de comida con IA.
 *
 * El modelo NO hace cuentas: devuelve, por alimento, los gramos estimados y
 * los valores nutricionales por 100 g. Calorias, macros y totales se calculan
 * aca. Asi los totales siempre cierran, y el front puede recalcular al toque
 * cuando el usuario corrige los gramos (sin volver a llamar a la IA).
 */

/** Modelo para analizar comidas. Precio en `AICostService.calculateCost`. */
export const FOOD_MODEL = 'gpt-6-luna';

export const FOOD_CATEGORIES = [
  'protein',
  'carbs',
  'vegetables',
  'fruits',
  'dairy',
  'fats',
  'beverages',
  'processed',
  'other',
] as const;
export type FoodCategoryValue = (typeof FOOD_CATEGORIES)[number];

export type Certainty = 'alta' | 'media' | 'baja';

export interface Per100g {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number; // mg
}

export interface MacroTotals {
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
}

/** Lo que devuelve el modelo (ver FOOD_ANALYSIS_SCHEMA). */
export interface RawFoodItem {
  name: string;
  quantity: string;
  grams: number;
  category: string;
  certainty: Certainty | string;
  per100g: Per100g;
}

export interface RawFoodAnalysis {
  foods: RawFoodItem[];
  assumptions: string[];
}

export interface AnalyzedFood {
  name: string;
  quantity: string;
  /** Peso tal como se come. Editable en el front: recalcula con `per100g`. */
  grams: number;
  per100g: Per100g;
  calories: number;
  confidence: number;
  macronutrients: MacroTotals;
  category: FoodCategoryValue;
}

export interface FoodAnalysisResult {
  foods: AnalyzedFood[];
  totalCalories: number;
  macronutrients: MacroTotals;
  confidence: number;
  mealType: string;
  /** Supuestos que mas mueven el numero, para que el usuario los corrija. */
  assumptions: string[];
  aiCostUsd?: number | null;
}

/** El analisis no produjo nada usable. NUNCA se reemplaza por datos falsos. */
export class FoodAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FoodAnalysisError';
  }
}

const CERTAINTY_SCORE: Record<string, number> = {
  alta: 0.9,
  media: 0.7,
  baja: 0.45,
};

/** Topes fisicos por 100 g: nada tiene mas de 100 g de un macro ni >900 kcal. */
const PER100_MAX: Per100g = {
  calories: 900,
  protein: 100,
  carbs: 100,
  fat: 100,
  fiber: 100,
  sugar: 100,
  sodium: 40000,
};

/** Tolerancia entre las kcal del modelo y las que dan los macros (4/4/9). */
const ATWATER_TOLERANCE = 0.25;

const round1 = (n: number) => Math.round(n * 10) / 10;
const isNum = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);

function cleanPer100g(p: Per100g | undefined, category: string): Per100g | null {
  if (!p) return null;
  const keys = Object.keys(PER100_MAX) as (keyof Per100g)[];
  // Calorias y los 3 macros son obligatorios; no se inventan.
  if (![p.calories, p.protein, p.carbs, p.fat].every(isNum)) return null;

  const out = {} as Per100g;
  for (const k of keys) {
    const v = isNum(p[k]) ? p[k] : 0; // fibra/azucar/sodio faltantes = 0
    out[k] = Math.max(0, Math.min(PER100_MAX[k], v));
  }

  // Coherencia: las kcal tienen que parecerse a 4P + 4C + 9G. Si no, mandan
  // los macros. Las bebidas quedan afuera: el alcohol suma kcal sin macros.
  if (category !== 'beverages') {
    const atwater = 4 * out.protein + 4 * out.carbs + 9 * out.fat;
    if (
      atwater > 0 &&
      Math.abs(out.calories - atwater) / atwater > ATWATER_TOLERANCE
    ) {
      out.calories = Math.round(atwater);
    }
  }
  return out;
}

export function nutritionForGrams(
  per100g: Per100g,
  grams: number,
): { calories: number; macronutrients: MacroTotals } {
  const f = grams / 100;
  return {
    calories: Math.round(per100g.calories * f),
    macronutrients: {
      protein: round1(per100g.protein * f),
      carbs: round1(per100g.carbs * f),
      fat: round1(per100g.fat * f),
      fiber: round1(per100g.fiber * f),
      sugar: round1(per100g.sugar * f),
      sodium: Math.round(per100g.sodium * f),
    },
  };
}

export function buildFoodAnalysis(
  raw: RawFoodAnalysis,
  mealType: string,
  servings = 1,
): FoodAnalysisResult {
  const portions = isNum(servings) && servings > 0 ? servings : 1;
  const items = Array.isArray(raw?.foods) ? raw.foods : [];

  const foods: AnalyzedFood[] = [];
  for (const it of items) {
    if (!it || !isNum(it.grams) || it.grams <= 0) continue;
    const category = (FOOD_CATEGORIES as readonly string[]).includes(it.category)
      ? (it.category as FoodCategoryValue)
      : 'other';
    const per100g = cleanPer100g(it.per100g, category);
    if (!per100g) continue;

    const grams = Math.round(it.grams * portions);
    const { calories, macronutrients } = nutritionForGrams(per100g, grams);
    foods.push({
      name: String(it.name || '').trim() || 'Alimento',
      quantity: String(it.quantity || '').trim() || `${grams} g`,
      grams,
      per100g,
      calories,
      confidence: CERTAINTY_SCORE[it.certainty] ?? CERTAINTY_SCORE.media,
      macronutrients,
      category,
    });
  }

  if (!foods.length) {
    throw new FoodAnalysisError('No se pudo identificar ningún alimento');
  }

  const totalCalories = foods.reduce((s, f) => s + f.calories, 0);
  const macronutrients = foods.reduce<MacroTotals>(
    (t, f) => ({
      protein: round1(t.protein + f.macronutrients.protein),
      carbs: round1(t.carbs + f.macronutrients.carbs),
      fat: round1(t.fat + f.macronutrients.fat),
      fiber: round1(t.fiber + f.macronutrients.fiber),
      sugar: round1(t.sugar + f.macronutrients.sugar),
      sodium: Math.round(t.sodium + f.macronutrients.sodium),
    }),
    { protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 },
  );

  // Confianza del plato: la de cada alimento pesada por sus calorias (un
  // condimento dudoso no tira abajo un plato bien identificado).
  const confidence =
    totalCalories > 0
      ? foods.reduce((s, f) => s + f.confidence * f.calories, 0) / totalCalories
      : foods.reduce((s, f) => s + f.confidence, 0) / foods.length;

  const assumptions = (Array.isArray(raw.assumptions) ? raw.assumptions : [])
    .map((a) => String(a ?? '').trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 5);

  return {
    foods,
    totalCalories,
    macronutrients,
    confidence: Math.round(confidence * 100) / 100,
    mealType,
    assumptions,
  };
}

/** Structured output (strict): el modelo no puede devolver otra forma. */
export const FOOD_ANALYSIS_SCHEMA = {
  name: 'food_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['foods', 'assumptions'],
    properties: {
      foods: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'quantity', 'grams', 'category', 'certainty', 'per100g'],
          properties: {
            name: {
              type: 'string',
              description:
                'Alimento con su preparación, en español rioplatense (ej: "Milanesa de carne frita").',
            },
            quantity: {
              type: 'string',
              description:
                'Cantidad en medida casera (ej: "1 unidad mediana", "2 rebanadas", "1 taza").',
            },
            grams: {
              type: 'number',
              description:
                'Peso estimado en gramos TAL COMO SE COME (cocido/preparado). Líquidos: ml.',
            },
            category: { type: 'string', enum: [...FOOD_CATEGORIES] },
            certainty: {
              type: 'string',
              enum: ['alta', 'media', 'baja'],
              description:
                'alta: cantidad dada por el usuario o producto con etiqueta. media: estimación visual razonable. baja: adiviné el alimento o la cantidad.',
            },
            per100g: {
              type: 'object',
              additionalProperties: false,
              description:
                'Valores por 100 g del alimento tal como se come, de tablas de composición.',
              required: ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium'],
              properties: {
                calories: { type: 'number' },
                protein: { type: 'number' },
                carbs: { type: 'number' },
                fat: { type: 'number' },
                fiber: { type: 'number' },
                sugar: { type: 'number' },
                sodium: { type: 'number', description: 'miligramos' },
              },
            },
          },
        },
      },
      assumptions: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Hasta 4 supuestos que más mueven el resultado, cada uno en una frase corta.',
      },
    },
  },
} as const;

export const FOOD_SYSTEM_PROMPT = `Sos un nutricionista argentino que estima el contenido nutricional de comidas para un diario de alimentación. Tu objetivo es acertar la CANTIDAD: en estas estimaciones el error casi siempre viene de los gramos, no de la tabla nutricional.

CÓMO TRABAJAR
1. Separá la comida en sus componentes reales, uno por alimento (la milanesa, el puré y el aceite de fritura van por separado). No devuelvas un único ítem "plato de comida".
2. Para cada uno estimá los gramos TAL COMO SE COME (cocido, escurrido, sin hueso ni cáscara). Si el usuario da un peso en crudo, convertilo a cocido.
3. Para cada uno devolvé los valores por 100 g del alimento ya preparado, de tablas de composición (USDA, Argenfoods) o de la etiqueta si es un producto envasado de marca conocida. No calcules totales: los hace el sistema.

CANTIDADES
- Lo que dice el usuario manda siempre por sobre lo que ves o suponés. Si da una cantidad ("150 g", "2 huevos", "media pizza"), usala exacta.
- En fotos usá referencias de escala: plato playo ~26 cm, plato de postre ~19 cm, tenedor ~19 cm, lata 354 ml, vaso común 250 ml, taza 200-250 ml. Considerá el alto de la porción, no solo la superficie.
- Sin cantidad ni foto, usá la porción habitual de un adulto en Argentina (milanesa ~150 g, bife ~200 g, plato de fideos cocidos ~250 g, empanada ~80 g, medialuna ~40 g, porción de pizza ~120 g, alfajor simple ~50 g, pan lactal ~25 g la rebanada).
- Comida de restaurante, rotisería o delivery: las porciones son más grandes y llevan más grasa que las caseras.

LO QUE NO SE VE
- Sumá como ítem aparte la grasa de cocción y los aderezos que casi seguro están: aceite absorbido en frituras, aceite o manteca en salteados, aceite en ensaladas condimentadas, manteca en un puré. Si el usuario aclara que no usó (o que fue al horno, air fryer, rocío vegetal), no lo sumes.
- No agregues azúcar, queso, salsas ni bebidas que no se ven y no se mencionan.
- Infusiones (mate, café, té) sin aclaración van sin azúcar. Con leche solo si se ve o se dice.

CASOS ESPECIALES
- Foto de una etiqueta nutricional o de un envase: usá los valores de la etiqueta y la porción que indique el usuario (o una porción del envase).
- Foto o texto de una receta: sumá los ingredientes y devolvé UNA porción, salvo que el usuario diga cuánto comió.
- Si el mensaje trae una corrección sobre un análisis anterior, cambiá solo lo que se corrige y dejá el resto igual.
- Si no hay comida identificable, devolvé "foods" vacío y explicá por qué en "assumptions".

SALIDA
- Nombres en español rioplatense, con la preparación ("Papas fritas", "Pechuga a la plancha").
- "certainty" honesta por ítem.
- "assumptions": hasta 4 frases cortas con lo que supusiste y más cambia el resultado (tamaño de porción, método de cocción, grasa agregada, tipo de corte o de producto). Escribilas para que el usuario pueda corregirte de un vistazo. Si no supusiste nada relevante, dejalo vacío.`;

export const MEAL_LABELS_ES: Record<string, string> = {
  breakfast: 'desayuno',
  lunch: 'almuerzo',
  merienda: 'merienda',
  dinner: 'cena',
  snack: 'snack',
  other: 'otra',
};
