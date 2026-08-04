/**
 * Hidratación por tramos: la ingesta del día se divide en bloques horarios
 * (ej: 1L hasta las 13, 1L de 13 a 20) con tramos opcionales condicionados a
 * entrenar (ej: +1.5L los días de entrenamiento). El "ritmo" esperado se
 * prorratea por el tiempo transcurrido dentro de cada tramo — es la base de
 * los recordatorios graduales ("vas 500ml abajo del ritmo de la mañana").
 */

export interface HydrationBlock {
  id: string;
  label: string;
  start: string; // HH:MM
  end: string; // HH:MM (mismo día, end > start)
  targetMl: number;
  requiresTraining?: boolean;
}

export interface PaceBlock extends HydrationBlock {
  active: boolean; // false si requiresTraining y no entrena hoy
  filledMl: number; // cuánto de este tramo ya se cubrió (se llenan en orden)
  expectedMl: number; // cuánto de este tramo se espera al momento consultado
  status: 'pending' | 'in_progress' | 'done' | 'skipped';
}

export interface HydrationPace {
  blocks: PaceBlock[];
  currentBlock: PaceBlock | null;
  totalTargetMl: number;
  consumedMl: number;
  expectedByNowMl: number;
  deficitMl: number; // cuánto le falta para ir a ritmo (0 = a ritmo o mejor)
  aheadMl: number; // cuánto viene adelantado
  goalReached: boolean;
  trainingActive: boolean;
}

export const DEFAULT_HYDRATION_BLOCKS: HydrationBlock[] = [
  { id: 'morning', label: 'Mañana', start: '07:00', end: '13:00', targetMl: 1000 },
  { id: 'afternoon', label: 'Tarde', start: '13:00', end: '20:00', targetMl: 1000 },
  {
    id: 'training',
    label: 'Entrenamiento',
    start: '18:00',
    end: '23:00',
    targetMl: 1500,
    requiresTraining: true,
  },
];

const toMinutes = (hhmm: string): number => {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) throw new Error(`Horario inválido: ${hhmm}`);
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
};

export function validateBlocks(blocks: HydrationBlock[]): void {
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > 6) {
    throw new Error('Tenés que definir entre 1 y 6 tramos');
  }
  for (const b of blocks) {
    if (!b.id || !b.label?.trim()) throw new Error('Cada tramo necesita nombre');
    const start = toMinutes(b.start);
    const end = toMinutes(b.end);
    if (end <= start) {
      throw new Error(`El tramo "${b.label}" termina antes de empezar`);
    }
    if (!Number.isFinite(b.targetMl) || b.targetMl <= 0) {
      throw new Error(`El tramo "${b.label}" necesita una meta en ml mayor a 0`);
    }
  }
}

/**
 * @param nowMinutes minutos desde medianoche (hora LOCAL del usuario)
 * @param consumedMl agua ya tomada hoy
 * @param trainingActive si hoy cuenta como día de entrenamiento
 */
export function computePace(
  blocks: HydrationBlock[],
  nowMinutes: number,
  consumedMl: number,
  trainingActive: boolean,
): HydrationPace {
  const enriched: PaceBlock[] = [];
  let remaining = consumedMl;
  let expectedByNowMl = 0;
  let totalTargetMl = 0;
  let currentBlock: PaceBlock | null = null;

  // Orden cronológico por inicio para llenar en orden
  const ordered = [...blocks].sort(
    (a, b) => toMinutes(a.start) - toMinutes(b.start),
  );

  for (const block of ordered) {
    const active = !block.requiresTraining || trainingActive;
    const start = toMinutes(block.start);
    const end = toMinutes(block.end);

    let expectedMl = 0;
    let status: PaceBlock['status'] = 'pending';
    if (!active) {
      status = 'skipped';
    } else {
      totalTargetMl += block.targetMl;
      if (nowMinutes >= end) {
        expectedMl = block.targetMl;
        status = 'done';
      } else if (nowMinutes > start) {
        expectedMl = Math.round(
          ((nowMinutes - start) / (end - start)) * block.targetMl,
        );
        status = 'in_progress';
      }
      expectedByNowMl += expectedMl;
    }

    const filledMl = active ? Math.min(remaining, block.targetMl) : 0;
    if (active) remaining -= filledMl;

    const pb: PaceBlock = { ...block, active, filledMl, expectedMl, status };
    // "done" del tramo por consumo (no solo por hora)
    if (active && filledMl >= block.targetMl) pb.status = 'done';
    if (active && status === 'in_progress' && pb.status !== 'done') {
      currentBlock = pb;
    }
    enriched.push(pb);
  }

  const deficitMl = Math.max(0, expectedByNowMl - consumedMl);
  return {
    blocks: enriched,
    currentBlock,
    totalTargetMl,
    consumedMl,
    expectedByNowMl,
    deficitMl,
    aheadMl: Math.max(0, consumedMl - expectedByNowMl),
    goalReached: totalTargetMl > 0 && consumedMl >= totalTargetMl,
    trainingActive,
  };
}
