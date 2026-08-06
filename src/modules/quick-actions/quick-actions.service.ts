import { BadRequestException, Injectable } from '@nestjs/common';
import { HydrationService } from '../hydration/hydration.service';
import { MealPrepService } from '../meal-prep/meal-prep.service';
import { NotesService } from '../notes/notes.service';
import { ExpensesService } from '../expenses/expenses.service';
import { ExpenseCategorizerService } from '../expenses/expense-categorizer.service';
import { AnalyzeFoodService } from '../analyze-food/analyze-food.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { PhysicalActivitiesService } from '../physical-activities/physical-activities.service';
import { PrismaService } from '../../config/prisma.service';
import { getLocalDateString } from '../../common/utils/date.utils';

export interface QuickActionsConfig {
  aguaVasosPorTap: number; // 1-10 vasos por tap (ej: botella 750ml = 3)
  notaMoodDefault: number; // 1-5
  gastoCategoriaDefault: string | null; // nombre de categoría
}

const CONFIG_DEFAULTS: QuickActionsConfig = {
  aguaVasosPorTap: 1,
  notaMoodDefault: 3,
  gastoCategoriaDefault: null,
};

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
    private readonly categorizer: ExpenseCategorizerService,
    private readonly analyzeFood: AnalyzeFoodService,
    private readonly nutrition: NutritionService,
    private readonly physical: PhysicalActivitiesService,
    private readonly prisma: PrismaService,
  ) {}

  async getConfig(userId: string): Promise<QuickActionsConfig> {
    const prefs = await this.prisma.userPreferences.findUnique({
      where: { userId },
    });
    return { ...CONFIG_DEFAULTS, ...((prefs?.quickActions as any) || {}) };
  }

  async setConfig(userId: string, partial: Partial<QuickActionsConfig>) {
    if (
      partial.aguaVasosPorTap !== undefined &&
      (!Number.isInteger(partial.aguaVasosPorTap) ||
        partial.aguaVasosPorTap < 1 ||
        partial.aguaVasosPorTap > 10)
    ) {
      throw new BadRequestException('Vasos por tap: entero entre 1 y 10');
    }
    if (
      partial.notaMoodDefault !== undefined &&
      (!Number.isInteger(partial.notaMoodDefault) ||
        partial.notaMoodDefault < 1 ||
        partial.notaMoodDefault > 5)
    ) {
      throw new BadRequestException('Mood default: entero entre 1 y 5');
    }
    const current = await this.getConfig(userId);
    const merged = { ...current, ...partial };
    await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, quickActions: merged as any },
      update: { quickActions: merged as any },
    });
    return merged;
  }

  async agua(userId: string, vasos?: number) {
    const date = getLocalDateString();
    const delta = vasos ?? (await this.getConfig(userId)).aguaVasosPorTap;
    const log = await this.hydration.adjust(userId, { date, delta });
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

  /**
   * Comida FUERA del meal prep, dictada: "milanesa con puré y una coca".
   * OpenAI estima calorías/macros y se loguea en el slot de la hora actual.
   */
  async comida(userId: string, texto: string) {
    if (!texto?.trim()) {
      throw new BadRequestException('Falta la descripción de la comida');
    }
    const mealType = slotForHour(localHour());
    const analysis = await this.analyzeFood.analyzeManualFood(
      texto.trim(),
      1,
      mealType as any,
      undefined,
      userId,
    );
    await this.nutrition.create(
      {
        date: getLocalDateString(),
        mealType,
        foods: analysis.foods,
        totalCalories: analysis.totalCalories,
        macronutrients: analysis.macronutrients,
        aiConfidence: analysis.confidence,
        context: `Quick action: "${texto.trim()}"`,
      } as any,
      userId,
    );
    return {
      message: `🍽️ Registrado (${mealType}): ${analysis.totalCalories} kcal — ${analysis.foods.map((f) => f.name).join(', ')} +15 XP`,
    };
  }

  /**
   * Entrenamiento terminado (ej: automatización de Apple Watch Workout).
   * Con lo que venga: minutos, kcal, distancia y/o tipo.
   */
  async entreno(
    userId: string,
    datos: {
      minutos?: number;
      kcal?: number;
      distancia_km?: number;
      tipo?: string;
    },
  ) {
    const minutos = datos.minutos ? Math.round(datos.minutos) : undefined;
    const kcal = datos.kcal ? Math.round(datos.kcal) : undefined;
    if (!minutos && !kcal && !datos.distancia_km) {
      throw new BadRequestException(
        'Mandá al menos minutos, kcal o distancia del entrenamiento',
      );
    }
    await this.physical.create(
      {
        date: getLocalDateString(),
        exerciseMinutes: minutos,
        activeEnergyKcal: kcal,
        distanceKm: datos.distancia_km,
        context: datos.tipo?.trim() || undefined,
      } as any,
      userId,
    );
    const partes = [
      minutos ? `${minutos} min` : null,
      kcal ? `${kcal} kcal` : null,
      datos.distancia_km ? `${datos.distancia_km} km` : null,
    ].filter(Boolean);
    return {
      message: `🏋️ Entreno registrado${datos.tipo ? ` (${datos.tipo})` : ''}: ${partes.join(' · ')} +60 XP`,
    };
  }

  async gasto(
    userId: string,
    monto: number,
    descripcion: string,
    tarjeta = false,
  ) {
    const config = await this.getConfig(userId);
    let categoryId: string | null = null;
    if (config.gastoCategoriaDefault) {
      const cats = await this.expenses.getCategories(userId);
      const q = config.gastoCategoriaDefault.toLowerCase();
      categoryId =
        cats.find((c) => c.name.toLowerCase() === q)?.id ||
        cats.find((c) => c.name.toLowerCase().includes(q))?.id ||
        null;
    }
    // Consumo con tarjeta de CRÉDITO (ej: Apple Pay con la Visa): va al buffer
    // del próximo resumen, no al gasto del mes. El importador de resumen lo
    // consume al confirmar (dedup por monto).
    if (tarjeta) {
      const sug = categoryId
        ? null
        : await this.categorizer
            .categorize(userId, descripcion)
            .catch(() => null);
      await this.prisma.expense.create({
        data: {
          userId,
          date: getLocalDateString(),
          amount: monto,
          description: `${descripcion} (Visa crédito)`,
          categoryId: categoryId || sug?.categoryId || null,
          source: 'tarjeta-pendiente',
        },
      });
      return {
        message: `💳 Anotado en el próximo resumen: ${ars(monto)} — ${descripcion}`,
      };
    }
    const exp = await this.expenses.createExpense(userId, {
      date: getLocalDateString(),
      amount: monto,
      description: descripcion,
      categoryId,
    });
    return { message: `💸 Gasto registrado: ${ars(exp.amount)} — ${exp.description}` };
  }

  async nota(userId: string, texto: string, mood?: number) {
    if (!texto?.trim()) {
      throw new BadRequestException('Falta el texto de la reflexión');
    }
    const effective =
      mood ?? (await this.getConfig(userId)).notaMoodDefault;
    const clamped = Math.max(1, Math.min(5, Math.round(effective)));
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
