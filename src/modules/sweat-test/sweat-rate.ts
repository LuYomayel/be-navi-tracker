/**
 * Test de sudoración: el dato que falta para dejar de estimar cuánta agua se
 * necesita. La tasa de sudoración varía de 0,5 a 2,5 L/h entre personas, así
 * que toda fórmula genérica es un rango. Con 2-3 mediciones propias se pasa
 * a un número real, y de ahí sale la meta diaria (variable según se entrene).
 *
 * Fórmula: sudor = (peso antes - peso después) + líquido ingerido - orina.
 * Cada kilo perdido = 1 litro de agua.
 */

import { HydrationBlock } from '../hydration/hydration-pace';

export interface SweatTestInput {
  weightBeforeKg: number;
  weightAfterKg: number;
  fluidIntakeMl: number;
  urineMl?: number;
  durationMin: number;
}

export type DehydrationLevel =
  | 'ok'
  | 'sed'
  | 'rendimiento'
  | 'fuerza'
  | 'critico';

export interface SweatTestResult {
  sweatMl: number;
  sweatRateMlPerHour: number;
  /** Lo que efectivamente perdió (sin contar lo que repuso tomando). */
  netDeficitMl: number;
  pctBodyWeightLost: number;
  level: DehydrationLevel;
  /** Reposición post: 130% de lo perdido (se sigue sudando y filtrando después). */
  rehydrateMl: number;
}

/** Umbrales por % de peso corporal perdido, con qué pasa en cada uno. */
export const DEHYDRATION_LEVELS: Record<
  DehydrationLevel,
  { max: number; label: string; detail: string }
> = {
  ok: {
    max: 1,
    label: 'Bien hidratado',
    detail: 'Menos del 1%: sin impacto en el rendimiento.',
  },
  sed: {
    max: 2,
    label: 'Aparece la sed',
    detail: 'Entre 1 y 2%: rendimiento casi intacto, pero ya vas en déficit.',
  },
  rendimiento: {
    max: 3,
    label: 'Caída de rendimiento',
    detail:
      'Más del 2%: caída medible del aeróbico, el mismo esfuerzo se siente más duro.',
  },
  fuerza: {
    max: 5,
    label: 'Baja fuerza y potencia',
    detail: 'Más del 3%: baja la potencia y se compromete la termorregulación.',
  },
  critico: {
    max: Infinity,
    label: 'Zona de riesgo',
    detail: 'Más del 5%: territorio de golpe de calor.',
  },
};

const LEVEL_ORDER: DehydrationLevel[] = [
  'ok',
  'sed',
  'rendimiento',
  'fuerza',
  'critico',
];

export function classifyDehydration(pctLost: number): DehydrationLevel {
  for (const level of LEVEL_ORDER) {
    if (pctLost < DEHYDRATION_LEVELS[level].max) return level;
  }
  return 'critico';
}

export function computeSweatTest(input: SweatTestInput): SweatTestResult {
  const { weightBeforeKg, weightAfterKg, fluidIntakeMl, durationMin } = input;
  const urineMl = input.urineMl ?? 0;

  if (!(weightBeforeKg > 0) || !(weightAfterKg > 0)) {
    throw new Error('Los pesos tienen que ser mayores a cero');
  }
  if (weightAfterKg > weightBeforeKg) {
    throw new Error('El peso después no puede ser mayor al peso antes');
  }
  if (!(durationMin > 0)) {
    throw new Error('La duración tiene que ser mayor a cero');
  }

  const netDeficitMl = Math.round((weightBeforeKg - weightAfterKg) * 1000);
  const sweatMl = Math.max(0, netDeficitMl + fluidIntakeMl - urineMl);
  const sweatRateMlPerHour = Math.round(sweatMl / (durationMin / 60));
  const pctBodyWeightLost =
    ((weightBeforeKg - weightAfterKg) / weightBeforeKg) * 100;

  return {
    sweatMl,
    sweatRateMlPerHour,
    netDeficitMl,
    pctBodyWeightLost: Math.round(pctBodyWeightLost * 100) / 100,
    level: classifyDehydration(pctBodyWeightLost),
    rehydrateMl: Math.round(netDeficitMl * 1.3),
  };
}

export interface DailyIntakeInput {
  weightKg: number;
  /** Tasa medida. Sin ella se usa una estimación conservadora. */
  sweatRateMlPerHour?: number;
  trainingHours: number;
  creatine: boolean;
}

export interface DailyIntakeResult {
  baseMl: number;
  trainingMl: number;
  creatineMl: number;
  totalMl: number;
  /** Lo que hay que TOMAR: el total menos lo que aporta la comida y el metabolismo. */
  drinkMl: number;
  glasses: number;
  sweatRateMlPerHour: number;
  estimated: boolean;
  suggestedBlocks: HydrationBlock[];
}

/** Sin test propio: promedio razonable para deporte de equipo bajo techo. */
export const DEFAULT_SWEAT_RATE_ML_H = 1000;
/** 20-25% del agua que entra viene de la comida y del metabolismo. */
const FOOD_FRACTION = 0.22;
/** Se repone 125-150% de lo perdido. */
const REPLACEMENT_FACTOR = 1.3;
const ML_PER_GLASS = 250;

const roundTo50 = (ml: number) => Math.round(ml / 50) * 50;

export function recommendDailyIntake(
  input: DailyIntakeInput,
): DailyIntakeResult {
  const { weightKg, trainingHours, creatine } = input;
  if (!(weightKg > 0)) throw new Error('Falta el peso corporal');

  const estimated = input.sweatRateMlPerHour == null;
  const sweatRateMlPerHour = input.sweatRateMlPerHour ?? DEFAULT_SWEAT_RATE_ML_H;

  const baseMl = Math.round(weightKg * 35);
  const trainingMl = Math.round(
    sweatRateMlPerHour * Math.max(0, trainingHours) * REPLACEMENT_FACTOR,
  );
  const creatineMl = creatine ? 400 : 0;
  const totalMl = baseMl + trainingMl + creatineMl;
  const drinkMl = Math.round(totalMl * (1 - FOOD_FRACTION));

  return {
    baseMl,
    trainingMl,
    creatineMl,
    totalMl,
    drinkMl,
    glasses: Math.round(drinkMl / ML_PER_GLASS),
    sweatRateMlPerHour,
    estimated,
    suggestedBlocks: buildBlocks(drinkMl, Math.round(trainingMl * (1 - FOOD_FRACTION))),
  };
}

/**
 * Reparte lo que hay que tomar en tramos horarios: la parte del entrenamiento
 * queda en un tramo condicionado (solo cuenta los días que entrena) y el resto
 * se divide entre mañana y tarde. La suma da exactamente drinkMl.
 */
function buildBlocks(drinkMl: number, trainingDrinkMl: number): HydrationBlock[] {
  const trainingShare = Math.min(
    roundTo50(Math.max(0, trainingDrinkMl)),
    Math.max(0, drinkMl - 100),
  );
  const rest = drinkMl - trainingShare;
  const morning = roundTo50(rest / 2);
  const afternoon = rest - morning;

  const blocks: HydrationBlock[] = [
    { id: 'morning', label: 'Mañana', start: '07:00', end: '13:00', targetMl: morning },
    { id: 'afternoon', label: 'Tarde', start: '13:00', end: '20:00', targetMl: afternoon },
  ];
  if (trainingShare > 0) {
    blocks.push({
      id: 'training',
      label: 'Entrenamiento',
      start: '18:00',
      end: '23:00',
      targetMl: trainingShare,
      requiresTraining: true,
    });
  }
  return blocks;
}
