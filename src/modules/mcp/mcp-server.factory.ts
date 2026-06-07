import { Injectable, Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { PrismaService } from '../../config/prisma.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { HydrationService } from '../hydration/hydration.service';
import { CompletionsService } from '../completions/completions.service';
import { ActivitiesService } from '../activities/activities.service';
import { DayScoreService } from '../day-score/day-score.service';
import { TasksService } from '../tasks/tasks.service';
import { getLocalDateString } from '../../common/utils/date.utils';

/** Resultado de tool con texto plano (formato que espera el SDK MCP). */
function text(message: string) {
  return { content: [{ type: 'text' as const, text: message }] };
}

/** Mapea el tipo de comida en español al `mealType` del modelo. */
const MEAL_TYPE_MAP: Record<string, string> = {
  Desayuno: 'breakfast',
  Almuerzo: 'lunch',
  Merienda: 'snack',
  Cena: 'dinner',
  Snack: 'snack',
};

/**
 * Firma simplificada de `registerTool`. Se usa `as any` a proposito: los
 * generics de la SDK + zod disparan "Type instantiation is excessively deep"
 * bajo la config TS de este proyecto (module: commonjs / moduleResolution: node).
 * El cast no afecta el runtime ni el JSON Schema publicado por la tool.
 */
type ToolConfig = {
  title?: string;
  description: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
};

@Injectable()
export class McpServerFactory {
  private readonly logger = new Logger(McpServerFactory.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nutrition: NutritionService,
    private readonly hydration: HydrationService,
    private readonly completions: CompletionsService,
    private readonly activities: ActivitiesService,
    private readonly dayScore: DayScoreService,
    private readonly tasks: TasksService,
  ) {}

  /**
   * Construye un McpServer con todas las tools, atadas al `userId` resuelto
   * desde el token OAuth. Cada request HTTP crea su propio server (stateless).
   */
  build(userId: string): McpServer {
    const server = new McpServer({ name: 'navitracker', version: '1.0.0' });
    const add = (
      name: string,
      config: ToolConfig,
      handler: (args: any) => Promise<any>,
    ) => {
      (server.registerTool as any)(name, config, async (args: any) => {
        try {
          return await handler(args || {});
        } catch (err) {
          this.logger.error(`Error en tool ${name}: ${(err as Error).message}`);
          return {
            content: [
              {
                type: 'text' as const,
                text: `No se pudo completar "${name}": ${(err as Error).message}`,
              },
            ],
            isError: true,
          };
        }
      });
    };

    this.registerWriteTools(server, userId, add);
    this.registerReadTools(server, userId, add);
    return server;
  }

  // ────────────────────────────────────────────────────────────
  //  Tools de escritura (loguear)
  // ────────────────────────────────────────────────────────────

  private registerWriteTools(
    _server: McpServer,
    userId: string,
    add: (n: string, c: ToolConfig, h: (a: any) => Promise<any>) => void,
  ) {
    add(
      'log_comida',
      {
        title: 'Registrar comida',
        description:
          'Registra una comida en el diario nutricional del usuario (desayuno, almuerzo, merienda, cena o snack), con calorias y macros opcionales.',
        inputSchema: {
          tipo: z
            .enum(['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Snack'])
            .describe('Tipo de comida'),
          detalle: z.string().describe('Que comio (descripcion libre)'),
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
          calorias: z.number().optional().describe('Calorias totales (kcal)'),
          proteina_g: z.number().optional().describe('Proteina en gramos'),
          carbos_g: z.number().optional().describe('Carbohidratos en gramos'),
          grasa_g: z.number().optional().describe('Grasa en gramos'),
          fibra_g: z.number().optional().describe('Fibra en gramos'),
          notas: z.string().optional().describe('Notas / contexto adicional'),
        },
      },
      async (a) => {
        const fecha = a.fecha || getLocalDateString();
        const calorias = a.calorias ?? 0;
        const analysis = await this.nutrition.create(
          {
            date: fecha,
            mealType: MEAL_TYPE_MAP[a.tipo] || 'other',
            foods: [
              {
                name: a.detalle,
                quantity: 1,
                unit: 'porcion',
                calories: calorias,
                confidence: 1,
              },
            ],
            totalCalories: Math.round(calorias),
            macronutrients: {
              protein: a.proteina_g ?? 0,
              carbs: a.carbos_g ?? 0,
              fat: a.grasa_g ?? 0,
              fiber: a.fibra_g ?? 0,
            },
            aiConfidence: 1,
            ...(a.notas ? { context: a.notas } : {}),
          } as any,
          userId,
        );
        return text(
          `Comida registrada (${a.tipo}, ${fecha}): "${a.detalle}" — ${calorias} kcal. id ${analysis.id}.`,
        );
      },
    );

    add(
      'set_habito',
      {
        title: 'Marcar o desmarcar un habito',
        description:
          'Marca (hecho=true) o desmarca (hecho=false) un habito del usuario para una fecha. El habito se identifica por su nombre. Usa list_habitos si no sabes los nombres disponibles.',
        inputSchema: {
          habito: z
            .string()
            .describe('Nombre del habito (ej: "Creatina", "Agua", "Gym")'),
          hecho: z
            .boolean()
            .optional()
            .describe(
              'true para marcarlo como hecho (default), false para desmarcar',
            ),
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
        },
      },
      async (a) => {
        const fecha = a.fecha || getLocalDateString();
        const desired = a.hecho ?? true;
        const all = await this.activities.getAll(userId, false);
        const target = (all as any[]).find(
          (act) => act.name?.toLowerCase() === a.habito.toLowerCase(),
        );
        const fuzzy =
          target ||
          (all as any[]).find((act) =>
            act.name?.toLowerCase().includes(a.habito.toLowerCase()),
          );
        if (!fuzzy) {
          const names = (all as any[]).map((x) => x.name).join(', ');
          return text(
            `No encontre un habito llamado "${a.habito}". Habitos disponibles: ${names || '(ninguno)'}.`,
          );
        }
        const current = (fuzzy.completions || []).find(
          (c: any) => c.date === fecha,
        );
        const isDone = !!current?.completed;
        if (isDone === desired) {
          return text(
            `"${fuzzy.name}" ya estaba ${desired ? 'marcado' : 'desmarcado'} para ${fecha}. Sin cambios.`,
          );
        }
        await this.completions.toggle(fuzzy.id, fecha, userId);
        return text(
          `Habito "${fuzzy.name}" ${desired ? 'marcado como hecho' : 'desmarcado'} para ${fecha}.`,
        );
      },
    );

    add(
      'log_peso',
      {
        title: 'Registrar peso',
        description:
          'Registra el peso corporal del usuario (y opcionalmente % de grasa, musculo y agua). Se guarda con la fecha de hoy.',
        inputSchema: {
          peso_kg: z.number().describe('Peso en kilogramos'),
          grasa_corporal_pct: z
            .number()
            .optional()
            .describe('Porcentaje de grasa corporal'),
          masa_muscular_pct: z
            .number()
            .optional()
            .describe('Porcentaje de masa muscular'),
          agua_pct: z
            .number()
            .optional()
            .describe('Porcentaje de agua corporal'),
          notas: z.string().optional().describe('Notas'),
        },
      },
      async (a) => {
        const entry = await this.nutrition.analyzeWeightManual(
          {
            date: getLocalDateString(),
            weight: a.peso_kg,
            bodyFatPercentage: a.grasa_corporal_pct,
            muscleMassPercentage: a.masa_muscular_pct,
            bodyWaterPercentage: a.agua_pct,
            source: 'manual',
            notes: a.notas,
          } as any,
          userId,
        );
        if (!entry) throw new Error('No se pudo guardar el peso');
        return text(
          `Peso registrado: ${a.peso_kg} kg (${entry.date}).` +
            (a.grasa_corporal_pct ? ` Grasa: ${a.grasa_corporal_pct}%.` : ''),
        );
      },
    );

    add(
      'set_agua',
      {
        title: 'Fijar vasos de agua del dia',
        description:
          'Fija la cantidad total de vasos de agua consumidos en una fecha (valor absoluto). Para sumar/restar respecto de lo que ya habia, usa agregar_agua.',
        inputSchema: {
          vasos: z.number().int().describe('Cantidad total de vasos del dia'),
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
        },
      },
      async (a) => {
        const fecha = a.fecha || getLocalDateString();
        const log = await this.hydration.set(userId, {
          date: fecha,
          glasses: a.vasos,
        });
        return text(
          `Hidratacion fijada en ${log.glassesConsumed} vasos (${log.mlConsumed} ml) para ${fecha}.`,
        );
      },
    );

    add(
      'agregar_agua',
      {
        title: 'Sumar o restar vasos de agua',
        description:
          'Suma (delta positivo) o resta (delta negativo) vasos de agua a lo ya registrado en la fecha. Ej: "tome 2 vasos" → delta 2.',
        inputSchema: {
          delta: z
            .number()
            .int()
            .describe('Vasos a sumar (positivo) o restar (negativo)'),
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
        },
      },
      async (a) => {
        const fecha = a.fecha || getLocalDateString();
        const log = await this.hydration.adjust(userId, {
          date: fecha,
          delta: a.delta,
        });
        return text(
          `Hidratacion actualizada: ${log.glassesConsumed} vasos (${log.mlConsumed} ml) para ${fecha}.`,
        );
      },
    );

    add(
      'crear_tarea',
      {
        title: 'Crear tarea',
        description:
          'Crea una tarea / pendiente para el usuario, opcionalmente con fecha y hora de vencimiento y prioridad.',
        inputSchema: {
          titulo: z.string().describe('Titulo de la tarea'),
          descripcion: z.string().optional().describe('Detalle de la tarea'),
          fecha: z
            .string()
            .optional()
            .describe('Fecha de vencimiento YYYY-MM-DD'),
          hora: z.string().optional().describe('Hora de vencimiento HH:MM'),
          prioridad: z
            .enum(['low', 'medium', 'high', 'urgent'])
            .optional()
            .describe('Prioridad'),
          categoria: z.string().optional().describe('Categoria'),
        },
      },
      async (a) => {
        const task = await this.tasks.create(userId, {
          title: a.titulo,
          description: a.descripcion,
          dueDate: a.fecha,
          dueTime: a.hora,
          priority: a.prioridad,
          category: a.categoria,
        } as any);
        return text(
          `Tarea creada: "${task.title}"${task.dueDate ? ` (vence ${task.dueDate}${task.dueTime ? ' ' + task.dueTime : ''})` : ''}. id ${task.id}.`,
        );
      },
    );
  }

  // ────────────────────────────────────────────────────────────
  //  Tools de lectura (briefing)
  // ────────────────────────────────────────────────────────────

  private registerReadTools(
    _server: McpServer,
    userId: string,
    add: (n: string, c: ToolConfig, h: (a: any) => Promise<any>) => void,
  ) {
    add(
      'list_habitos',
      {
        title: 'Listar habitos',
        description:
          'Devuelve los habitos activos del usuario con su nombre y en que dias de la semana aplican. Util para saber que nombre pasar a set_habito.',
      },
      async () => {
        const all = await this.activities.getAll(userId, false);
        if (!all.length) return text('El usuario no tiene habitos cargados.');
        const dias = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
        const lines = (all as any[]).map((h) => {
          const days = Array.isArray(h.days)
            ? h.days
                .map((d: boolean, i: number) => (d ? dias[i] : null))
                .filter(Boolean)
                .join('')
            : 'todos';
          return `• ${h.name}${h.category ? ` [${h.category}]` : ''} (${days || 'sin dias'})`;
        });
        return text(`Habitos:\n${lines.join('\n')}`);
      },
    );

    add(
      'get_resumen_dia',
      {
        title: 'Resumen del dia',
        description:
          'Devuelve como viene el dia: comidas y totales de macros vs objetivo, hidratacion, habitos completados, tareas y puntaje del dia.',
        inputSchema: {
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
        },
      },
      async (a) => {
        const fecha = a.fecha || getLocalDateString();
        const lines: string[] = [`📅 Resumen ${fecha}`];

        // Nutricion
        const meals = await this.prisma.nutritionAnalysis.findMany({
          where: { userId, date: fecha },
          orderBy: { createdAt: 'asc' },
        });
        const totals = meals.reduce(
          (acc, m: any) => {
            acc.cal += m.totalCalories || 0;
            acc.p += (m.macronutrients as any)?.protein || 0;
            acc.c += (m.macronutrients as any)?.carbs || 0;
            acc.f += (m.macronutrients as any)?.fat || 0;
            return acc;
          },
          { cal: 0, p: 0, c: 0, f: 0 },
        );
        const prefs = await this.prisma.userPreferences.findUnique({
          where: { userId },
        });
        const goal = prefs?.dailyCalorieGoal;
        lines.push(
          `🍽️ Comidas (${meals.length}): ${Math.round(totals.cal)} kcal` +
            (goal ? ` / ${goal} objetivo` : '') +
            ` — P ${Math.round(totals.p)}g · C ${Math.round(totals.c)}g · G ${Math.round(totals.f)}g`,
        );
        if (meals.length) {
          lines.push(
            ...meals.map(
              (m: any) =>
                `   - ${m.mealType}: ${(m.foods as any[])?.[0]?.name ?? '?'} (${m.totalCalories} kcal)`,
            ),
          );
        }

        // Hidratacion
        const water = await this.hydration.getByDate(userId, fecha);
        const waterGoal = await this.hydration.getGoal(userId);
        lines.push(
          `💧 Agua: ${water.glassesConsumed}/${waterGoal.goalGlasses} vasos (${water.mlConsumed} ml)`,
        );

        // Habitos
        const habits = await this.activities.getAll(userId, false);
        const dayIdx = this.weekdayIndex(fecha);
        const scheduled = (habits as any[]).filter(
          (h) => !Array.isArray(h.days) || h.days[dayIdx],
        );
        const done = scheduled.filter((h) =>
          (h.completions || []).some(
            (c: any) => c.date === fecha && c.completed,
          ),
        );
        lines.push(
          `✅ Habitos: ${done.length}/${scheduled.length} completados`,
        );

        // Tareas
        const tasks = await this.tasks.findAll(userId, { date: fecha });
        const tasksDone = (tasks as any[]).filter((t) => t.completed).length;
        lines.push(`📝 Tareas: ${tasksDone}/${tasks.length} completadas`);

        // Day score
        try {
          const score = await this.dayScore.getOrCalculate(userId, fecha);
          lines.push(
            `🏆 Day score: ${Math.round(score.percentage)}% (${score.status})`,
          );
        } catch {
          /* opcional */
        }

        return text(lines.join('\n'));
      },
    );

    add(
      'get_plan_hoy',
      {
        title: 'Plan del dia',
        description:
          'Devuelve el plan del dia: habitos programados para esa fecha y tareas pendientes con vencimiento ese dia.',
        inputSchema: {
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
        },
      },
      async (a) => {
        const fecha = a.fecha || getLocalDateString();
        const dayIdx = this.weekdayIndex(fecha);
        const habits = await this.activities.getAll(userId, false);
        const scheduled = (habits as any[]).filter(
          (h) => !Array.isArray(h.days) || h.days[dayIdx],
        );
        const tasks = await this.tasks.findAll(userId, { date: fecha });
        const pending = (tasks as any[]).filter((t) => !t.completed);

        const lines: string[] = [`🗓️ Plan ${fecha}`];
        lines.push(
          `Habitos del dia (${scheduled.length}):` +
            (scheduled.length
              ? '\n' +
                scheduled
                  .map((h) => {
                    const done = (h.completions || []).some(
                      (c: any) => c.date === fecha && c.completed,
                    );
                    return `   ${done ? '✓' : '○'} ${h.name}${h.time ? ` @ ${h.time}` : ''}`;
                  })
                  .join('\n')
              : ' (ninguno)'),
        );
        lines.push(
          `Tareas pendientes (${pending.length}):` +
            (pending.length
              ? '\n' +
                pending
                  .map(
                    (t) =>
                      `   ○ ${t.title}${t.dueTime ? ` @ ${t.dueTime}` : ''} [${t.priority}]`,
                  )
                  .join('\n')
              : ' (ninguna)'),
        );
        return text(lines.join('\n'));
      },
    );

    add(
      'get_comidas',
      {
        title: 'Listar comidas en un rango',
        description:
          'Lista las comidas registradas entre dos fechas (inclusive), con sus calorias y macros. Util para informes (ej: para la nutricionista).',
        inputSchema: {
          desde: z.string().describe('Fecha inicial YYYY-MM-DD'),
          hasta: z.string().describe('Fecha final YYYY-MM-DD'),
        },
      },
      async (a) => {
        const meals = await this.prisma.nutritionAnalysis.findMany({
          where: { userId, date: { gte: a.desde, lte: a.hasta } },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        });
        if (!meals.length) {
          return text(
            `No hay comidas registradas entre ${a.desde} y ${a.hasta}.`,
          );
        }
        const lines = meals.map((m: any) => {
          const macros = m.macronutrients as any;
          return `${m.date} · ${m.mealType}: ${(m.foods as any[])?.[0]?.name ?? '?'} — ${m.totalCalories} kcal (P${Math.round(macros?.protein || 0)}/C${Math.round(macros?.carbs || 0)}/G${Math.round(macros?.fat || 0)})`;
        });
        const totalCal = meals.reduce(
          (s, m: any) => s + (m.totalCalories || 0),
          0,
        );
        return text(
          `Comidas ${a.desde} → ${a.hasta} (${meals.length}):\n${lines.join('\n')}\n\nTotal: ${totalCal} kcal.`,
        );
      },
    );

    add(
      'get_day_score',
      {
        title: 'Puntaje del dia',
        description:
          'Devuelve el day score (porcentaje de cumplimiento y estado won/partial/lost) de una fecha.',
        inputSchema: {
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
        },
      },
      async (a) => {
        const fecha = a.fecha || getLocalDateString();
        const score = await this.dayScore.getOrCalculate(userId, fecha);
        return text(
          `Day score ${fecha}: ${Math.round(score.percentage)}% — ${score.status}. ` +
            `Habitos ${score.habitsCompleted}/${score.habitsTotal}, ` +
            `tareas ${score.tasksCompleted}/${score.tasksTotal}, ` +
            `nutricion ${score.nutritionLogged ? 'sí' : 'no'}, ` +
            `hidratacion ${score.hydrationLogged ? 'sí' : 'no'}.`,
        );
      },
    );
  }

  /** Indice de dia de la semana para el array `days` ([L,M,X,J,V,S,D]). */
  private weekdayIndex(fecha: string): number {
    // Mediodia para evitar corrimientos por zona horaria.
    const jsDay = new Date(`${fecha}T12:00:00`).getDay(); // 0=Dom..6=Sab
    return (jsDay + 6) % 7; // 0=Lun..6=Dom
  }
}
