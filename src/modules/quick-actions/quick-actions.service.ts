import { BadRequestException, Injectable } from '@nestjs/common';
import { HydrationService } from '../hydration/hydration.service';
import { MealPrepService } from '../meal-prep/meal-prep.service';
import { NotesService } from '../notes/notes.service';
import { ExpensesService } from '../expenses/expenses.service';
import { AnalyzeFoodService } from '../analyze-food/analyze-food.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { PhysicalActivitiesService } from '../physical-activities/physical-activities.service';
import {
  SleepService,
  parseDuration,
  formatDuration,
  clockFromList,
  minutesBetween,
} from '../sleep/sleep.service';
import { DayScoreService } from '../day-score/day-score.service';
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

/**
 * Muestra un valor recibido para poder debuggear el atajo desde el celular:
 * la respuesta es lo único que se ve desde el iPhone.
 */
function muestra(v: unknown): string {
  const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  if (!s) return '(vacío)';
  return `"${s.length > 60 ? `${s.slice(0, 60)}…` : s}"`;
}

/**
 * El `Amount` de una transacción de Apple Wallet llega formateado como moneda
 * ("$1.500,00", "ARS 1.500,00", "$1,500.00"): el atajo no lo puede limpiar, así
 * que lo parseamos acá — mismo criterio que `parseDuration` para el sueño.
 *
 * Separador solitario: 3 dígitos detrás = miles ("1.500" → 1500), si no
 * = decimales ("1.50" → 1.5). Con los dos separadores, el último manda.
 */
export function parseMonto(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;

  //   y   son los espacios duros que mete Intl entre símbolo y número
  const limpio = raw.replace(/[\s  ]/g, '');
  if (!limpio) return null;
  const negativo = limpio.includes('-') || /^\(.+\)$/.test(limpio);

  // Fuera el símbolo y el código de moneda ($, ARS, US$…)
  const numero = limpio.replace(/[^\d.,]/g, '');
  if (!/\d/.test(numero)) return null;

  const posComa = numero.lastIndexOf(',');
  const posPunto = numero.lastIndexOf('.');
  let decimal = '';
  if (posComa >= 0 && posPunto >= 0) {
    decimal = posComa > posPunto ? ',' : '.';
  } else if (posComa >= 0 || posPunto >= 0) {
    const sep = posComa >= 0 ? ',' : '.';
    const pos = Math.max(posComa, posPunto);
    const digitosDetras = numero.length - pos - 1;
    const apariciones = numero.split(sep).length - 1;
    decimal = apariciones === 1 && digitosDetras !== 3 ? sep : '';
  }

  let normalizado: string;
  if (decimal) {
    const pos = numero.lastIndexOf(decimal);
    const entera = numero.slice(0, pos).replace(/[.,]/g, '') || '0';
    const decimales = numero.slice(pos + 1).replace(/[.,]/g, '');
    normalizado = `${entera}.${decimales}`;
  } else {
    normalizado = numero.replace(/[.,]/g, '');
  }

  const n = Number(normalizado);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

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
    private readonly analyzeFood: AnalyzeFoodService,
    private readonly nutrition: NutritionService,
    private readonly physical: PhysicalActivitiesService,
    private readonly sleep: SleepService,
    private readonly dayScore: DayScoreService,
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

  /**
   * Cierre del día (automatización de las 22:00): qué falta para que el día
   * sea ganado, en una línea que entre en una notificación. Primero lo que
   * todavía se puede resolver esa misma noche.
   */
  async cierreDia(userId: string) {
    const hoy = getLocalDateString();
    const s: any = await this.dayScore.getOrCalculate(userId, hoy);
    const pct = Math.round(s?.percentage ?? 0);

    if (s?.status === 'won') {
      return { message: `🌙 Día ganado al ${pct}%. A dormir tranquilo 😴` };
    }

    const faltan: string[] = [];
    if (!s?.hydrationLogged) faltan.push(await this.vasosQueFaltan(userId));
    if (!s?.reflectionLogged) faltan.push('la reflexión');
    if (s?.sleepTracked && !s?.sleepLogged) faltan.push('dormir tus 7 horas');
    if (!s?.nutritionLogged) faltan.push('registrar la comida');
    if (!s?.exerciseLogged) faltan.push('moverte un rato');
    const tareas = (s?.tasksTotal ?? 0) - (s?.tasksCompleted ?? 0);
    if (tareas > 0) faltan.push(`${tareas} ${tareas === 1 ? 'tarea' : 'tareas'}`);
    const habitos = (s?.habitsTotal ?? 0) - (s?.habitsCompleted ?? 0);
    if (habitos > 0)
      faltan.push(`${habitos} ${habitos === 1 ? 'hábito' : 'hábitos'}`);

    if (!faltan.length) {
      return { message: `🌙 Día ${pct}%. Ya no queda nada pendiente 👌` };
    }

    // Máximo 3: una notificación con una lista larga no se lee.
    const top = faltan.slice(0, 3);
    const lista =
      top.length === 1
        ? top[0]
        : `${top.slice(0, -1).join(', ')} y ${top[top.length - 1]}`;
    return { message: `🌙 Día ${pct}% — te falta ${lista} para día ganado.` };
  }

  /** "2 vasos de agua" si se puede contar; si no, "el agua". */
  private async vasosQueFaltan(userId: string): Promise<string> {
    try {
      const [log, goal] = await Promise.all([
        this.hydration.getByDate(userId, getLocalDateString()),
        this.hydration.getGoal(userId),
      ]);
      const restan = (goal?.goalGlasses ?? 0) - (log?.glassesConsumed ?? 0);
      if (restan > 0) {
        return `${restan} ${restan === 1 ? 'vaso' : 'vasos'} de agua`;
      }
    } catch {
      /* sin datos: se menciona genérico */
    }
    return 'el agua';
  }

  /**
   * Sueño de anoche (automatización "al despertar" del Watch/iPhone). Se
   * guarda en el día de HOY, que es cuando se despertó.
   */
  async sueno(
    userId: string,
    datos: {
      duracion?: number | string;
      calidad?: number;
      acoste?: string;
      desperte?: string;
      profundo?: number;
      rem?: number;
      despierto?: number;
      pulsaciones?: number;
    },
  ) {
    // La automatización "Wake" de iOS NO pasa ningún input, así que lo más
    // simple es que el atajo mande los horarios de la muestra de Health y la
    // duración la calculemos acá.
    const minutos =
      parseDuration(datos.duracion) ??
      minutesBetween(datos.acoste, datos.desperte);
    if (!minutos) {
      // Devolvemos lo que llegó: desde el celular es la única forma de ver
      // qué mandó el atajo (vacío = la búsqueda de Health no encontró nada).
      throw new BadRequestException(
        `No entendí cuánto dormiste. Recibí acoste=${muestra(datos.acoste)} · desperte=${muestra(datos.desperte)} · duracion=${muestra(datos.duracion)}. Si están vacíos, la búsqueda de Health no devolvió muestras (revisá el filtro de fechas).`,
      );
    }
    await this.sleep.upsertSleep(userId, {
      date: getLocalDateString(),
      minutesAsleep: minutos,
      quality: datos.calidad,
      // Si vino la lista de fragmentos: se acostó en el primero y se
      // despertó en el último.
      bedTime: clockFromList(datos.acoste, 'first', datos.desperte),
      wakeTime: clockFromList(datos.desperte, 'last', datos.acoste),
      deepMinutes: datos.profundo,
      remMinutes: datos.rem,
      awakeMinutes: datos.despierto,
      heartRateAvg: datos.pulsaciones,
      source: 'shortcut',
    });
    // Mostrar la ventana usada: si el atajo agarró el fragmento equivocado,
    // el número solo no lo delata, pero "23:15 → 07:00" sí.
    const desde = clockFromList(datos.acoste, 'first', datos.desperte);
    const hasta = clockFromList(datos.desperte, 'last', datos.acoste);
    const ventana = desde && hasta ? ` (${desde} → ${hasta})` : '';
    const extra = datos.calidad ? ` · calidad ${datos.calidad}/5` : '';
    return {
      message: `😴 Dormiste ${formatDuration(minutos)}${ventana}${extra}. ¡Buen día!`,
    };
  }

  async gasto(
    userId: string,
    monto: number | string,
    descripcion: string,
    tarjeta: boolean | string = false,
  ) {
    // El atajo de Wallet manda el Amount tal cual lo formatea iOS.
    const importe = parseMonto(monto);
    if (importe === null || importe <= 0) {
      throw new BadRequestException(
        `No entendí el monto. Recibí monto=${muestra(monto)} · descripcion=${muestra(descripcion)}. Si dice "Amount" o está vacío, la variable del atajo no trajo valor.`,
      );
    }
    // Merchant puede venir vacío (transferencias, algunos comercios).
    const detalle = String(descripcion || '').trim() || 'Gasto rápido';
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
    // Consumo con tarjeta de CRÉDITO (ej: Apple Pay): va al buffer del próximo
    // resumen, no al gasto del mes. `tarjeta` puede ser true (la Visa propia)
    // o el nombre de otra tarjeta (ej: "Hermano").
    if (tarjeta) {
      const card = typeof tarjeta === 'string' ? tarjeta.trim() : null;
      await this.expenses.createExpense(userId, {
        date: getLocalDateString(),
        amount: importe,
        description: detalle,
        categoryId,
        tarjeta: true,
        card,
      });
      return {
        message: `💳 Anotado en el próximo resumen (${card || 'Visa'}): ${ars(importe)} — ${detalle}`,
      };
    }
    const exp = await this.expenses.createExpense(userId, {
      date: getLocalDateString(),
      amount: importe,
      description: detalle,
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
