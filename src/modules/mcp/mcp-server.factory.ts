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
import { SavedMealsService } from '../saved-meals/saved-meals.service';
import { GoalService } from '../goal/goal.service';
import { BriefingService } from '../briefing/briefing.service';
import { AnalyzeFoodService } from '../analyze-food/analyze-food.service';
import { TrelloService } from '../trello/trello.service';
import { NotesService } from '../notes/notes.service';
import { getLocalDateString } from '../../common/utils/date.utils';
import {
  parseDiasHabito,
  formatDias,
  resolveColorHabito,
} from './habito-utils';

/** Resultado de tool con texto plano (formato que espera el SDK MCP). */
function text(message: string) {
  return { content: [{ type: 'text' as const, text: message }] };
}

/** Mapea el tipo de comida en español al `mealType` del modelo. */
export const MEAL_TYPE_MAP: Record<string, string> = {
  Desayuno: 'breakfast',
  Almuerzo: 'lunch',
  Merienda: 'merienda',
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
    private readonly savedMeals: SavedMealsService,
    private readonly goal: GoalService,
    private readonly briefing: BriefingService,
    private readonly analyzeFood: AnalyzeFoodService,
    private readonly trello: TrelloService,
    private readonly notes: NotesService,
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
    this.registerNotesAndTasksTools(server, userId, add);
    return server;
  }

  /**
   * Resuelve un habito por nombre (exacto y luego parcial, case-insensitive).
   * Devuelve el activity o null. Reutilizado por editar/eliminar habito.
   */
  private async findHabitoByName(
    userId: string,
    nombre: string,
  ): Promise<any | null> {
    const all = (await this.activities.getAll(userId, false)) as any[];
    const lower = nombre.toLowerCase();
    return (
      all.find((act) => act.name?.toLowerCase() === lower) ||
      all.find((act) => act.name?.toLowerCase().includes(lower)) ||
      null
    );
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
          confirmar: z
            .boolean()
            .optional()
            .describe(
              'Pasá true para registrar igual aunque ya exista una comida de ese tipo ese dia (evita duplicados por reintento).',
            ),
        },
      },
      async (a) => {
        const fecha = a.fecha || getLocalDateString();
        const mealType = MEAL_TYPE_MAP[a.tipo] || 'other';
        if (!a.confirmar) {
          const dup = await this.prisma.nutritionAnalysis.findFirst({
            where: { userId, date: fecha, mealType },
          });
          if (dup) {
            const prev = (dup.foods as any)?.[0]?.name || '';
            return text(
              `Ya hay un ${a.tipo} registrado para ${fecha}${prev ? ` ("${prev}", ${dup.totalCalories} kcal)` : ''}. Si querés agregar otro igual, repetí con confirmar=true.`,
            );
          }
        }
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
      'crear_habito',
      {
        title: 'Crear un habito',
        description:
          'Crea un nuevo habito (actividad recurrente) para el usuario. Por defecto aplica todos los dias; se puede acotar con "dias" (ej "L,M,V", "lun mie vie", "habiles", "finde").',
        inputSchema: {
          nombre: z.string().describe('Nombre del habito (ej: "3D 5 min")'),
          dias: z
            .string()
            .optional()
            .describe(
              'Dias en que aplica. Ej: "todos", "L,M,V", "lun,mie,vie", "habiles", "finde". Por defecto todos los dias.',
            ),
          descripcion: z
            .string()
            .optional()
            .describe('Descripcion / recordatorio de la version minima.'),
          horario: z
            .string()
            .optional()
            .describe('Horario sugerido (texto libre, ej "08:00").'),
          categoria: z
            .string()
            .optional()
            .describe('Categoria (ej: health, work, personal).'),
          color: z
            .string()
            .optional()
            .describe('Color hex (ej "#22c55e"). Si no se pasa, se asigna uno.'),
        },
      },
      async (a) => {
        if (!a.nombre || !a.nombre.trim()) {
          return text('Necesito un nombre para crear el habito.');
        }
        const existente = await this.findHabitoByName(userId, a.nombre.trim());
        if (existente && existente.name?.toLowerCase() === a.nombre.trim().toLowerCase()) {
          return text(
            `Ya existe un habito llamado "${existente.name}". Usa editar_habito si queres cambiarlo.`,
          );
        }
        const days = parseDiasHabito(a.dias);
        const created = await this.activities.create(
          {
            name: a.nombre.trim(),
            days,
            color: resolveColorHabito(a.color),
            description: a.descripcion,
            time: a.horario,
            category: a.categoria,
          } as any,
          userId,
        );
        return text(
          `Habito "${created.name}" creado (${formatDias(days)}).`,
        );
      },
    );

    add(
      'editar_habito',
      {
        title: 'Editar un habito',
        description:
          'Edita un habito existente identificado por su nombre actual. Solo cambia los campos que pases (nombre, dias, descripcion, horario, categoria, color).',
        inputSchema: {
          habito: z
            .string()
            .describe('Nombre actual del habito a editar.'),
          nuevo_nombre: z.string().optional().describe('Nuevo nombre.'),
          dias: z
            .string()
            .optional()
            .describe('Nuevos dias (ej "L,M,V", "todos", "finde").'),
          descripcion: z.string().optional().describe('Nueva descripcion.'),
          horario: z.string().optional().describe('Nuevo horario.'),
          categoria: z.string().optional().describe('Nueva categoria.'),
          color: z.string().optional().describe('Nuevo color hex.'),
        },
      },
      async (a) => {
        const target = await this.findHabitoByName(userId, a.habito);
        if (!target) {
          const all = (await this.activities.getAll(userId, false)) as any[];
          const names = all.map((x) => x.name).join(', ');
          return text(
            `No encontre un habito llamado "${a.habito}". Habitos: ${names || '(ninguno)'}.`,
          );
        }
        const patch: any = {};
        if (a.nuevo_nombre?.trim()) patch.name = a.nuevo_nombre.trim();
        if (a.dias !== undefined) patch.days = parseDiasHabito(a.dias);
        if (a.descripcion !== undefined) patch.description = a.descripcion;
        if (a.horario !== undefined) patch.time = a.horario;
        if (a.categoria !== undefined) patch.category = a.categoria;
        if (a.color !== undefined) patch.color = resolveColorHabito(a.color);

        if (Object.keys(patch).length === 0) {
          return text('No indicaste ningun cambio. El habito quedo igual.');
        }
        const updated = await this.activities.update(target.id, patch, userId);
        if (!updated) {
          return text(`No pude actualizar el habito "${target.name}".`);
        }
        return text(
          `Habito "${updated.name}" actualizado (${formatDias(updated.days)}).`,
        );
      },
    );

    add(
      'eliminar_habito',
      {
        title: 'Eliminar (archivar) un habito',
        description:
          'Elimina un habito identificado por su nombre. Por defecto lo ARCHIVA (reversible). Pasa permanente=true para borrarlo definitivamente.',
        inputSchema: {
          habito: z.string().describe('Nombre del habito a eliminar.'),
          permanente: z
            .boolean()
            .optional()
            .describe(
              'true = borrado definitivo. false/omitido = archivar (reversible, default).',
            ),
        },
      },
      async (a) => {
        const target = await this.findHabitoByName(userId, a.habito);
        if (!target) {
          const all = (await this.activities.getAll(userId, false)) as any[];
          const names = all.map((x) => x.name).join(', ');
          return text(
            `No encontre un habito llamado "${a.habito}". Habitos: ${names || '(ninguno)'}.`,
          );
        }
        if (a.permanente) {
          const ok = await this.activities.delete(target.id, userId);
          return text(
            ok
              ? `Habito "${target.name}" borrado definitivamente.`
              : `No pude borrar el habito "${target.name}".`,
          );
        }
        const archived = await this.activities.archive(target.id, userId);
        return text(
          archived
            ? `Habito "${target.name}" archivado (lo podes restaurar desde la app).`
            : `No pude archivar el habito "${target.name}".`,
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

    add(
      'log_comida_guardada',
      {
        title: 'Loguear una comida guardada',
        description:
          'Registra en el diario nutricional una de las comidas guardadas del usuario (plantillas tipo "Desayuno de siempre"), identificada por su nombre. Crea el registro con sus calorias y macros ya conocidos, sin tener que detallarlos. Usa list_comidas_guardadas si no sabes los nombres disponibles.',
        inputSchema: {
          nombre: z
            .string()
            .describe(
              'Nombre de la comida guardada (ej: "Desayuno de siempre")',
            ),
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
        },
      },
      async (a) => {
        const meals = await this.savedMeals.getAll(userId);
        const q = a.nombre.toLowerCase();
        const target =
          (meals as any[]).find((m) => m.name?.toLowerCase() === q) ||
          (meals as any[]).find((m) => m.name?.toLowerCase().includes(q));
        if (!target) {
          const names = (meals as any[]).map((m) => m.name).join(', ');
          return text(
            `No encontre una comida guardada llamada "${a.nombre}". Guardadas: ${names || '(ninguna)'}.`,
          );
        }
        const res = await this.savedMeals.logAsNutrition(
          target.id,
          userId,
          a.fecha,
        );
        if (!res) return text(`No se pudo loguear "${target.name}".`);
        const fecha = a.fecha || getLocalDateString();
        return text(
          `Comida guardada registrada (${fecha}): "${target.name}" — ${target.totalCalories} kcal. id ${res.analysis.id}.`,
        );
      },
    );

    add(
      'create_objetivo_nz',
      {
        title: 'Crear el objetivo / fondo de ahorro',
        description:
          'Crea un objetivo de ahorro para el usuario (ej: el fondo para Nueva Zelanda). Indica nombre, meta en USD y, opcionalmente, fecha objetivo y monto ya ahorrado.',
        inputSchema: {
          nombre: z
            .string()
            .describe(
              'Nombre del objetivo (ej: "Nueva Zelanda + Imprimime 3D")',
            ),
          meta_usd: z.number().describe('Meta del fondo en USD (ej: 8000)'),
          fecha_objetivo: z
            .string()
            .optional()
            .describe('Fecha objetivo YYYY-MM-DD'),
          monto_inicial_usd: z
            .number()
            .optional()
            .describe('Monto ya ahorrado al crear el objetivo (USD)'),
          descripcion: z.string().optional().describe('Descripcion / contexto'),
        },
      },
      async (a) => {
        const g = await this.goal.create(
          {
            name: a.nombre,
            targetUsd: a.meta_usd,
            currentUsd: a.monto_inicial_usd,
            targetDate: a.fecha_objetivo,
            description: a.descripcion,
          },
          userId,
        );
        return text(
          `Objetivo creado: "${g.name}" — meta USD ${Math.round(g.targetUsd)}` +
            (g.targetDate ? ` para ${g.targetDate}` : '') +
            `. id ${g.id}.`,
        );
      },
    );

    add(
      'log_contribucion',
      {
        title: 'Registrar un aporte al fondo',
        description:
          'Suma un aporte al fondo del objetivo activo del usuario (ej: la ganancia de una venta de lamparas). Usa monto negativo para corregir o restar.',
        inputSchema: {
          monto_usd: z
            .number()
            .describe('Monto del aporte en USD (negativo para restar)'),
          descripcion: z
            .string()
            .optional()
            .describe('De donde salio (ej: "venta 2 lamparas")'),
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
        },
      },
      async (a) => {
        const res = await this.goal.logContribution(userId, {
          amountUsd: a.monto_usd,
          description: a.descripcion,
          date: a.fecha,
        });
        if (!res) {
          return text(
            'El usuario no tiene un objetivo activo. Crealo primero con create_objetivo_nz.',
          );
        }
        const g = res.goal;
        const pct =
          g.targetUsd > 0 ? Math.min(100, (g.currentUsd / g.targetUsd) * 100) : 0;
        const achieved = g.status === 'achieved' ? ' 🎉 ¡Meta alcanzada!' : '';
        return text(
          `Aporte de USD ${a.monto_usd} registrado en "${g.name}". ` +
            `Acumulado: USD ${Math.round(g.currentUsd)} / ${Math.round(g.targetUsd)} (${Math.round(pct)}%).${achieved}`,
        );
      },
    );

    add(
      'crear_comida_guardada',
      {
        title: 'Crear una comida guardada (plantilla)',
        description:
          'Crea una plantilla de comida reutilizable (ej: "Desayuno de siempre") con sus calorias y macros, para despues loguearla rapido con log_comida_guardada.',
        inputSchema: {
          nombre: z
            .string()
            .describe('Nombre de la plantilla (ej: "Merienda de siempre")'),
          tipo: z
            .enum(['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Snack'])
            .describe('Tipo de comida'),
          calorias: z.number().describe('Calorias totales (kcal)'),
          proteina_g: z.number().optional().describe('Proteina en gramos'),
          carbos_g: z.number().optional().describe('Carbohidratos en gramos'),
          grasa_g: z.number().optional().describe('Grasa en gramos'),
          fibra_g: z.number().optional().describe('Fibra en gramos'),
          descripcion: z.string().optional().describe('Descripcion breve'),
        },
      },
      async (a) => {
        const meal = await this.savedMeals.create(
          {
            name: a.nombre,
            description: a.descripcion,
            mealType: MEAL_TYPE_MAP[a.tipo] || 'other',
            foods: [
              {
                name: a.nombre,
                quantity: 1,
                unit: 'porcion',
                calories: a.calorias,
                confidence: 1,
              },
            ],
            totalCalories: Math.round(a.calorias),
            macronutrients: {
              protein: a.proteina_g ?? 0,
              carbs: a.carbos_g ?? 0,
              fat: a.grasa_g ?? 0,
              fiber: a.fibra_g ?? 0,
            },
          },
          userId,
        );
        return text(
          `Comida guardada creada: "${meal.name}" (${a.tipo}) — ${meal.totalCalories} kcal. id ${meal.id}.`,
        );
      },
    );

    add(
      'editar_comida_guardada',
      {
        title: 'Editar una comida guardada',
        description:
          'Cambia el nombre o la descripcion de una comida guardada existente, identificada por su nombre actual.',
        inputSchema: {
          nombre: z.string().describe('Nombre actual de la comida guardada'),
          nuevo_nombre: z.string().optional().describe('Nuevo nombre'),
          descripcion: z.string().optional().describe('Nueva descripcion'),
        },
      },
      async (a) => {
        const meals = await this.savedMeals.getAll(userId);
        const q = a.nombre.toLowerCase();
        const target =
          (meals as any[]).find((m) => m.name?.toLowerCase() === q) ||
          (meals as any[]).find((m) => m.name?.toLowerCase().includes(q));
        if (!target) {
          const names = (meals as any[]).map((m) => m.name).join(', ');
          return text(
            `No encontre una comida guardada llamada "${a.nombre}". Guardadas: ${names || '(ninguna)'}.`,
          );
        }
        await this.savedMeals.update(
          target.id,
          { name: a.nuevo_nombre, description: a.descripcion },
          userId,
        );
        return text(
          `Comida guardada actualizada: "${a.nuevo_nombre || target.name}".`,
        );
      },
    );

    add(
      'borrar_comida_guardada',
      {
        title: 'Borrar una comida guardada',
        description:
          'Elimina una comida guardada (plantilla) del usuario, identificada por su nombre.',
        inputSchema: {
          nombre: z
            .string()
            .describe('Nombre de la comida guardada a borrar'),
        },
      },
      async (a) => {
        const meals = await this.savedMeals.getAll(userId);
        const q = a.nombre.toLowerCase();
        const target =
          (meals as any[]).find((m) => m.name?.toLowerCase() === q) ||
          (meals as any[]).find((m) => m.name?.toLowerCase().includes(q));
        if (!target) {
          const names = (meals as any[]).map((m) => m.name).join(', ');
          return text(
            `No encontre una comida guardada llamada "${a.nombre}". Guardadas: ${names || '(ninguna)'}.`,
          );
        }
        await this.savedMeals.delete(target.id, userId);
        return text(`Comida guardada borrada: "${target.name}".`);
      },
    );

    add(
      'generar_briefing',
      {
        title: 'Generar el briefing del dia',
        description:
          'Genera (o regenera) y persiste el briefing del dia: resumen de habitos, tareas, nutricion, day-score, hidratacion y objetivo. Con enviar=true tambien lo manda por mail.',
        inputSchema: {
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
          enviar: z
            .boolean()
            .optional()
            .describe('Si true, manda el briefing por mail.'),
        },
      },
      async (a) => {
        if (a.enviar) {
          const { briefing, emailSent } =
            await this.briefing.generateAndSend(userId, a.fecha);
          return text(
            `${briefing.text}\n\n${emailSent ? '📧 Enviado por mail.' : '(mail no enviado: falta configurar RESEND_API_KEY)'}`,
          );
        }
        const briefing = await this.briefing.generate(userId, a.fecha);
        return text(briefing.text);
      },
    );

    add(
      'analizar_comida',
      {
        title: 'Analizar y loguear una comida (IA)',
        description:
          'Estima calorias y macros de una comida descrita en texto libre (con IA) y la registra en el diario. Ideal para loguear rapido cuando no sabes los gramos/macros (ej: "milanesa con pure").',
        inputSchema: {
          tipo: z
            .enum(['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Snack'])
            .describe('Tipo de comida'),
          detalle: z.string().describe('Que comiste, en texto libre'),
          porciones: z
            .number()
            .optional()
            .describe('Numero de porciones (default 1)'),
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
        },
      },
      async (a) => {
        const fecha = a.fecha || getLocalDateString();
        const mealType = MEAL_TYPE_MAP[a.tipo] || 'other';
        const r = await this.analyzeFood.analyzeManualFood(
          a.detalle,
          a.porciones || 1,
          mealType as any,
          undefined,
          userId,
        );
        const m = r.macronutrients;
        const analysis = await this.nutrition.create(
          {
            date: fecha,
            mealType,
            foods: r.foods,
            totalCalories: Math.round(r.totalCalories),
            macronutrients: m,
            aiConfidence: r.confidence ?? 1,
          } as any,
          userId,
        );
        return text(
          `Comida analizada y registrada (${a.tipo}, ${fecha}): ~${Math.round(r.totalCalories)} kcal · P ${Math.round(m.protein)} / C ${Math.round(m.carbs)} / G ${Math.round(m.fat)} g. id ${analysis.id}. (confianza ${Math.round((r.confidence ?? 1) * 100)}%)`,
        );
      },
    );

    add(
      'borrar_comida',
      {
        title: 'Borrar una comida registrada',
        description:
          'Borra una comida del diario por su id (usa list_comidas_dia para obtener los ids). Util para sacar duplicados o errores.',
        inputSchema: {
          id: z.string().describe('id de la comida (de list_comidas_dia)'),
        },
      },
      async (a) => {
        const ok = await this.nutrition.delete(a.id, userId);
        return text(
          ok
            ? `Comida borrada (id ${a.id}).`
            : `No se pudo borrar la comida ${a.id} (no existe o no es tuya).`,
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
      'list_comidas_guardadas',
      {
        title: 'Listar comidas guardadas',
        description:
          'Devuelve las comidas guardadas del usuario (plantillas reutilizables tipo "Desayuno de siempre") con su nombre, tipo y calorias. Util para saber que nombre pasar a log_comida_guardada.',
      },
      async () => {
        const meals = await this.savedMeals.getAll(userId);
        if (!meals.length)
          return text('El usuario no tiene comidas guardadas.');
        const lines = (meals as any[]).map(
          (m) =>
            `• ${m.name}${m.mealType ? ` [${m.mealType}]` : ''} — ${m.totalCalories} kcal`,
        );
        return text(`Comidas guardadas:\n${lines.join('\n')}`);
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

    add(
      'get_objetivo_nz',
      {
        title: 'Ver el objetivo / fondo',
        description:
          'Devuelve el estado del objetivo de ahorro del usuario (ej: fondo Nueva Zelanda): meta, acumulado, porcentaje, USD restantes y dias hasta la fecha objetivo.',
      },
      async () => {
        const p = await this.goal.getProgress(userId);
        if (!p) {
          return text(
            'El usuario todavia no tiene un objetivo cargado. Se puede crear con create_objetivo_nz.',
          );
        }
        const g = p.goal;
        const dias =
          p.daysRemaining != null
            ? ` · ${p.daysRemaining} dias hasta ${g.targetDate}`
            : '';
        return text(
          `🎯 ${g.name}: USD ${Math.round(g.currentUsd)} / ${Math.round(g.targetUsd)} ` +
            `(${Math.round(p.percentage)}%) — faltan USD ${Math.round(p.remainingUsd)}${dias}. ` +
            `Estado: ${g.status}.`,
        );
      },
    );

    add(
      'get_progreso_nz',
      {
        title: 'Progreso del objetivo',
        description:
          'Devuelve el progreso del fondo: porcentaje, USD restantes, dias hasta la fecha objetivo y cuanto habria que ahorrar por mes para llegar a tiempo.',
      },
      async () => {
        const p = await this.goal.getProgress(userId);
        if (!p) return text('El usuario todavia no tiene un objetivo cargado.');
        const lines: string[] = [
          `🎯 ${p.goal.name}`,
          `Progreso: ${Math.round(p.percentage)}% (USD ${Math.round(p.goal.currentUsd)} / ${Math.round(p.goal.targetUsd)})`,
          `Faltan: USD ${Math.round(p.remainingUsd)}`,
        ];
        if (p.daysRemaining != null) {
          lines.push(`Dias hasta ${p.goal.targetDate}: ${p.daysRemaining}`);
          if (p.daysRemaining > 0 && p.remainingUsd > 0) {
            const perMonth = p.remainingUsd / (p.daysRemaining / 30);
            lines.push(`Ritmo necesario: ~USD ${Math.round(perMonth)}/mes`);
          }
        }
        return text(lines.join('\n'));
      },
    );

    add(
      'get_briefing',
      {
        title: 'Briefing del dia',
        description:
          'Devuelve el briefing del dia (resumen de habitos, tareas, nutricion, score, hidratacion y objetivo). Si todavia no se genero, lo genera al vuelo.',
        inputSchema: {
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
        },
      },
      async (a) => {
        const existing = await this.briefing.getByDate(userId, a.fecha);
        if (existing) return text(existing.text);
        const generated = await this.briefing.generate(userId, a.fecha);
        return text(generated.text);
      },
    );

    add(
      'list_comidas_dia',
      {
        title: 'Listar comidas de un dia',
        description:
          'Lista las comidas registradas en una fecha con su id, tipo y calorias. Util para corregir o borrar duplicados (con borrar_comida).',
        inputSchema: {
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
        },
      },
      async (a) => {
        const fecha = a.fecha || getLocalDateString();
        const comidas = await this.nutrition.getByDate(fecha, userId);
        if (!comidas.length)
          return text(`Sin comidas registradas para ${fecha}.`);
        const lines = (comidas as any[]).map(
          (c) =>
            `• [${c.id}] ${c.mealType} — ${(c.foods as any)?.[0]?.name || 's/d'} (${c.totalCalories} kcal)`,
        );
        return text(`Comidas de ${fecha}:\n${lines.join('\n')}`);
      },
    );

    add(
      'informe_nutricion',
      {
        title: 'Informe nutricional por rango',
        description:
          'Agrega la nutricion de un rango de fechas: dias con registro, promedio diario de calorias y macros, y adherencia a los objetivos. Util para el informe de la nutricionista.',
        inputSchema: {
          desde: z.string().describe('Fecha inicio YYYY-MM-DD'),
          hasta: z.string().describe('Fecha fin YYYY-MM-DD'),
        },
      },
      async (a) => {
        const dates = this.dateRange(a.desde, a.hasta);
        const sum = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
        let days = 0;
        let goals: any = null;
        for (const d of dates) {
          const bal = await this.nutrition
            .getDailyNutritionBalance(userId, d)
            .catch(() => null);
          if (!bal || (bal.nutritionAnalyses?.length || 0) === 0) continue;
          days++;
          sum.calories += bal.consumed.calories;
          sum.protein += bal.consumed.protein;
          sum.carbs += bal.consumed.carbs;
          sum.fat += bal.consumed.fat;
          sum.fiber += bal.consumed.fiber;
          goals = bal.goals;
        }
        if (days === 0)
          return text(`Sin comidas registradas entre ${a.desde} y ${a.hasta}.`);
        const avg = (x: number) => Math.round(x / days);
        const lines = [
          `📊 Informe nutricional ${a.desde} → ${a.hasta}`,
          `Dias con registro: ${days}`,
          `Promedio diario: ${avg(sum.calories)} kcal · P ${avg(sum.protein)} / C ${avg(sum.carbs)} / G ${avg(sum.fat)} / fibra ${avg(sum.fiber)} g`,
        ];
        if (goals) {
          lines.push(
            `Objetivo: ${goals.dailyCalorieGoal} kcal · proteina ${goals.proteinGoal} g`,
            `Adherencia: calorias ${Math.round((avg(sum.calories) / goals.dailyCalorieGoal) * 100)}% · proteina ${Math.round((avg(sum.protein) / goals.proteinGoal) * 100)}%`,
          );
        }
        return text(lines.join('\n'));
      },
    );

    add(
      'get_tickets',
      {
        title: 'Tickets de trabajo (Trello)',
        description:
          'Devuelve los tickets prioritarios de trabajo desde Trello (boards Stampia, EaseTrain y Platform Dev): en curso, en revisión, próximos y los vencidos / por vencer. Read-only.',
      },
      async () => {
        const summary = await this.trello.getTicketsSummary();
        return text(summary || 'Sin tickets prioritarios.');
      },
    );
  }

  /** Genera las fechas YYYY-MM-DD entre `from` y `to` inclusive (max 366). */
  private dateRange(from: string, to: string): string[] {
    const out: string[] = [];
    const start = new Date(from + 'T12:00:00');
    const end = new Date(to + 'T12:00:00');
    const cur = new Date(start);
    let guard = 0;
    while (cur <= end && guard < 366) {
      out.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
      guard++;
    }
    return out;
  }

  /** Indice de dia de la semana para el array `days` ([L,M,X,J,V,S,D]). */
  // ────────────────────────────────────────────────────────────
  //  Tools de notas y tareas (captura libre + gestión de pendientes)
  // ────────────────────────────────────────────────────────────

  private registerNotesAndTasksTools(
    _server: McpServer,
    userId: string,
    add: (n: string, c: ToolConfig, h: (a: any) => Promise<any>) => void,
  ) {
    add(
      'crear_nota',
      {
        title: 'Guardar una nota / idea / decisión',
        description:
          'Guarda una nota libre del usuario: una idea, una decisión, algo para documentar. Para pendientes accionables usá crear_tarea; esto es para capturar texto libre.',
        inputSchema: {
          contenido: z.string().describe('El texto de la nota'),
          fecha: z
            .string()
            .optional()
            .describe('Fecha YYYY-MM-DD. Por defecto hoy.'),
        },
      },
      async (a) => {
        const fecha = a.fecha || getLocalDateString();
        const note = await this.notes.create(
          { date: fecha, content: a.contenido, mood: 3 } as any,
          userId,
        );
        return text(
          `Nota guardada (${fecha}): "${a.contenido}". id ${note.id}.`,
        );
      },
    );

    add(
      'get_notas',
      {
        title: 'Listar notas',
        description:
          'Devuelve las notas / ideas / decisiones guardadas del usuario (las últimas, o filtradas por fecha).',
        inputSchema: {
          fecha: z.string().optional().describe('Filtrar por fecha YYYY-MM-DD'),
        },
      },
      async (a) => {
        const all = (await this.notes.getAll(userId)) as any[];
        const filtered = a.fecha ? all.filter((n) => n.date === a.fecha) : all;
        const recent = filtered.slice(-15);
        if (!recent.length) {
          return text(
            a.fecha ? `Sin notas para ${a.fecha}.` : 'No hay notas guardadas.',
          );
        }
        const lines = recent.map(
          (n) =>
            `• [${n.date}] ${n.content}${n.customComment ? ` — ${n.customComment}` : ''}`,
        );
        return text(
          `Notas${a.fecha ? ` (${a.fecha})` : ' (últimas)'}:\n${lines.join('\n')}`,
        );
      },
    );

    add(
      'list_tareas',
      {
        title: 'Listar tareas',
        description:
          'Lista las tareas/pendientes del usuario. Por defecto solo las pendientes; opcionalmente por fecha o incluyendo las completadas.',
        inputSchema: {
          fecha: z
            .string()
            .optional()
            .describe('Filtrar por fecha de vencimiento YYYY-MM-DD'),
          incluir_completadas: z
            .boolean()
            .optional()
            .describe('Incluir las ya completadas (default false)'),
        },
      },
      async (a) => {
        const tasks = (await this.tasks.findAll(
          userId,
          a.fecha ? { date: a.fecha } : {},
        )) as any[];
        const list = a.incluir_completadas
          ? tasks
          : tasks.filter((t) => !t.completed);
        if (!list.length) {
          return text(
            'No hay tareas' +
              (a.fecha ? ` para ${a.fecha}` : ' pendientes') +
              '.',
          );
        }
        const lines = list.map(
          (t) =>
            `${t.completed ? '✓' : '○'} ${t.title}${t.dueDate ? ` (${t.dueDate}${t.dueTime ? ' ' + t.dueTime : ''})` : ''} [${t.priority}]`,
        );
        return text(`Tareas (${list.length}):\n${lines.join('\n')}`);
      },
    );

    add(
      'completar_tarea',
      {
        title: 'Completar una tarea',
        description:
          'Marca como completada una tarea del usuario, identificada por su título (o parte). Usá list_tareas si no sabés el nombre exacto.',
        inputSchema: {
          titulo: z
            .string()
            .describe('Título (o parte) de la tarea a completar'),
        },
      },
      async (a) => {
        const tasks = (await this.tasks.findAll(userId, {})) as any[];
        const pend = tasks.filter((t) => !t.completed);
        const q = a.titulo.toLowerCase();
        const target =
          pend.find((t) => t.title?.toLowerCase() === q) ||
          pend.find((t) => t.title?.toLowerCase().includes(q));
        if (!target) {
          const names = pend.map((t) => t.title).join(', ');
          return text(
            `No encontré una tarea pendiente "${a.titulo}". Pendientes: ${names || '(ninguna)'}.`,
          );
        }
        await this.tasks.toggle(userId, target.id);
        return text(`Tarea completada: "${target.title}". 💪`);
      },
    );
  }

  private weekdayIndex(fecha: string): number {
    // Mediodia para evitar corrimientos por zona horaria.
    const jsDay = new Date(`${fecha}T12:00:00`).getDay(); // 0=Dom..6=Sab
    return (jsDay + 6) % 7; // 0=Lun..6=Dom
  }
}
