import { BadRequestException, Injectable } from '@nestjs/common';
import { HydrationService } from '../hydration/hydration.service';
import { MealPrepService } from '../meal-prep/meal-prep.service';
import { NotesService } from '../notes/notes.service';
import { ExpensesService } from '../expenses/expenses.service';
import { getLocalDateString } from '../../common/utils/date.utils';

/**
 * Acciones de 1 tap para tags NFC / Atajos de iOS / complicaciones del Watch.
 * Autenticadas con token estático (QUICK_ACTIONS_TOKEN) porque los Atajos no
 * pueden renovar JWT. Solo escritura simple, nada sensible de lectura.
 */

const TZ = 'America/Argentina/Buenos_Aires';

export type MealSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner';

/** Slot del meal prep según la hora del día (ART). */
export function slotForHour(hour: number): MealSlot {
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 19) return 'snack';
  return 'dinner';
}

const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/** Día del meal prep (monday..sunday) para una fecha YYYY-MM-DD. */
export function dayKeyOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return DAY_KEYS[new Date(y, m - 1, d).getDay()];
}

function localHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
  );
}

const ars = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

@Injectable()
export class QuickActionsService {
  constructor(
    private readonly hydration: HydrationService,
    private readonly mealPrep: MealPrepService,
    private readonly notes: NotesService,
    private readonly expenses: ExpensesService,
  ) {}

  async agua(userId: string, vasos = 1) {
    const date = getLocalDateString();
    const log = await this.hydration.adjust(userId, { date, delta: vasos });
    const goal = await this.hydration.getGoal(userId);
    const done = log.glassesConsumed >= goal.goalGlasses;
    return {
      message: `💧 ${log.glassesConsumed}/${goal.goalGlasses} vasos hoy${done ? ' — ¡meta cumplida! 🎉' : ''}`,
    };
  }

  async comidaPlan(userId: string) {
    const prep = await this.mealPrep.getActiveMealPrep(userId);
    if (!prep) {
      throw new BadRequestException(
        'No hay un meal prep activo para marcar la comida',
      );
    }
    const date = getLocalDateString();
    const mealType = slotForHour(localHour());
    const result = await this.mealPrep.markSlotEaten(
      prep.id,
      { day: dayKeyOf(date), mealType, date } as any,
      userId,
    );
    const name = (result as any)?.slot?.name || '';
    return {
      message: `🍽️ Registrado (${mealType})${name ? `: ${name}` : ''} +15 XP`,
    };
  }

  async gasto(userId: string, monto: number, descripcion: string) {
    const exp = await this.expenses.createExpense(userId, {
      date: getLocalDateString(),
      amount: monto,
      description: descripcion,
    });
    return { message: `💸 Gasto registrado: ${ars(exp.amount)} — ${exp.description}` };
  }

  async nota(userId: string, texto: string, mood?: number) {
    if (!texto?.trim()) {
      throw new BadRequestException('Falta el texto de la reflexión');
    }
    const clamped =
      mood === undefined ? 3 : Math.max(1, Math.min(5, Math.round(mood)));
    await this.notes.create(
      {
        date: getLocalDateString(),
        content: texto.trim(),
        mood: clamped,
      } as any,
      userId,
    );
    return { message: `📝 Reflexión guardada (mood ${clamped}/5) +15 XP` };
  }
}
