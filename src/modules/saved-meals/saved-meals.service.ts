import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { AICostService } from '../ai-cost/ai-cost.service';
import { getLocalDateString } from '../../common/utils/date.utils';
import OpenAI from 'openai';

const PLATE_COMPONENTS = [
  'protein',
  'carb',
  'veggie',
  'drink',
  'fruit',
  'other',
] as const;

@Injectable()
export class SavedMealsService {
  private readonly logger = new Logger(SavedMealsService.name);

  private openai: OpenAI | null = null;

  constructor(
    private prisma: PrismaService,
    private nutrition: NutritionService,
    private aiCostService: AICostService,
  ) {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  async getAll(userId: string) {
    return this.prisma.savedMeal.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async create(data: {
    name: string;
    description?: string;
    mealType: string;
    component?: string;
    foods: any;
    totalCalories: number;
    macronutrients: any;
  }, userId: string) {
    return this.prisma.savedMeal.create({
      data: { ...data, userId },
    });
  }

  async use(id: string, userId: string) {
    const meal = await this.prisma.savedMeal.findFirst({
      where: { id, userId },
    });
    if (!meal) return null;

    await this.prisma.savedMeal.update({
      where: { id },
      data: {
        timesUsed: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
    return meal;
  }

  /**
   * Loguea una comida guardada en el diario nutricional: crea un
   * `NutritionAnalysis` real (con sus foods/macros) reutilizando el flujo de
   * `NutritionService.create` (mismo XP que un log manual) e incrementa el uso.
   * Devuelve `{ meal, analysis }`, o `null` si la comida no existe / no es del usuario.
   */
  async logAsNutrition(id: string, userId: string, date?: string) {
    const meal = await this.prisma.savedMeal.findFirst({
      where: { id, userId },
    });
    if (!meal) return null;

    const analysis = await this.nutrition.create(
      {
        date: date || getLocalDateString(),
        mealType: meal.mealType,
        foods: meal.foods,
        totalCalories: meal.totalCalories,
        macronutrients: meal.macronutrients,
        aiConfidence: 1,
      } as any,
      userId,
    );

    await this.prisma.savedMeal.update({
      where: { id },
      data: {
        timesUsed: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });

    return { meal, analysis };
  }

  /**
   * Plato modular: compone UNA comida a partir de varios componentes guardados
   * (proteína + carbo + verdura + bebida + fruta) sumando foods, calorías y
   * macros. Crea un solo NutritionAnalysis (mismo XP que un log normal) e
   * incrementa el uso de cada componente. Devuelve null si algún componente
   * no existe o no es del usuario.
   */
  async logPlate(
    userId: string,
    opts: { componentIds: string[]; mealType: string; date?: string },
  ) {
    const ids = [...new Set(opts.componentIds || [])];
    if (!ids.length) return null;

    const components = await this.prisma.savedMeal.findMany({
      where: { id: { in: ids }, userId },
    });
    if (components.length !== ids.length) return null;

    // Mantener el orden en que se armó el plato
    const ordered = ids.map((id) => components.find((c) => c.id === id)!);

    const foods = ordered.flatMap((c) =>
      Array.isArray(c.foods) ? (c.foods as any[]) : [],
    );
    const totalCalories = ordered.reduce((a, c) => a + c.totalCalories, 0);
    const macronutrients = ordered.reduce(
      (acc, c) => {
        const m = (c.macronutrients as any) || {};
        return {
          protein: acc.protein + (m.protein || 0),
          carbs: acc.carbs + (m.carbs || 0),
          fat: acc.fat + (m.fat || 0),
          fiber: acc.fiber + (m.fiber || 0),
        };
      },
      { protein: 0, carbs: 0, fat: 0, fiber: 0 },
    );

    const analysis = await this.nutrition.create(
      {
        date: opts.date || getLocalDateString(),
        mealType: opts.mealType,
        foods,
        totalCalories,
        macronutrients,
        aiConfidence: 1,
        context: `Plato: ${ordered.map((c) => c.name).join(' + ')}`,
      } as any,
      userId,
    );

    await Promise.all(
      ordered.map((c) =>
        this.prisma.savedMeal.update({
          where: { id: c.id },
          data: { timesUsed: { increment: 1 }, lastUsedAt: new Date() },
        }),
      ),
    );

    return { components: ordered, analysis };
  }

  /**
   * Clasifica en un solo shot todas las comidas guardadas sin componente de
   * plato (component=null): IA (gpt-4o-mini) por nombre, con fallback de
   * heurística por keywords si OpenAI no está disponible. Pensado para migrar
   * las comidas viejas de prod que quedaron como "comida completa".
   */
  async classifyComponents(userId: string) {
    const unclassified = await this.prisma.savedMeal.findMany({
      where: { userId, component: null },
    });
    if (!unclassified.length) {
      return { total: 0, classified: 0, results: [] as any[] };
    }

    let mapping: Record<string, string> = {};

    if (this.openai) {
      try {
        const list = unclassified
          .map((m) => `${m.id}: ${m.name}${m.description ? ` (${m.description})` : ''}`)
          .join('\n');
        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0,
          max_tokens: 1000,
          messages: [
            {
              role: 'user',
              content: `Clasificá cada comida guardada en UN componente de plato: protein (carnes, huevo, hamburguesas, pescado, milanesas), carb (pan, arroz, fideos, papa, avena, tostadas), veggie (ensaladas, verduras), drink (café, té, mate, jugos, licuados), fruit (frutas) u other (postres, mixtas que no encajan).\n\nComidas (id: nombre):\n${list}\n\nRespondé SOLO un JSON válido {id: componente}, sin markdown.`,
            },
          ],
        });
        await this.aiCostService.logFromCompletion(
          userId,
          'saved-meals-classify',
          completion as any,
        );
        const raw = completion.choices[0]?.message?.content || '{}';
        mapping = JSON.parse(
          raw.trim().replace(/^```json?\s*/, '').replace(/\s*```$/, ''),
        );
      } catch (error) {
        this.logger.error('Error clasificando con IA, uso heurística:', error);
        mapping = {};
      }
    }

    // Fallback / relleno heurístico para lo que la IA no resolvió
    const heuristic = (name: string): string | null => {
      const n = name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      const match = (words: string[]) => words.some((w) => n.includes(w));
      if (match(['cafe', 'te ', 'mate', 'jugo', 'licuado', 'agua', 'gaseosa']))
        return 'drink';
      if (match(['banana', 'manzana', 'naranja', 'pera', 'frutilla', 'fruta', 'kiwi', 'mandarina', 'durazno']))
        return 'fruit';
      if (match(['ensalada', 'verdura', 'brocoli', 'zanahoria', 'lechuga', 'tomate', 'calabaza', 'zapallo', 'espinaca']))
        return 'veggie';
      if (match(['hamburguesa', 'pollo', 'carne', 'huevo', 'clara', 'atun', 'pescado', 'milanesa', 'bife', 'cerdo', 'jamon', 'lomo']))
        return 'protein';
      if (match(['pan', 'arroz', 'fideo', 'pasta', 'papa', 'batata', 'avena', 'tostada', 'galletita', 'polenta', 'noqui', 'tarta']))
        return 'carb';
      return null;
    };

    let classified = 0;
    const results: { id: string; name: string; component: string }[] = [];
    for (const meal of unclassified) {
      let component = mapping[meal.id];
      if (!PLATE_COMPONENTS.includes(component as any)) {
        component = heuristic(meal.name) || '';
      }
      if (!PLATE_COMPONENTS.includes(component as any)) continue;
      await this.prisma.savedMeal.update({
        where: { id: meal.id },
        data: { component },
      });
      classified++;
      results.push({ id: meal.id, name: meal.name, component });
    }

    return { total: unclassified.length, classified, results };
  }

  async delete(id: string, userId: string) {
    return this.prisma.savedMeal.deleteMany({
      where: { id, userId },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      mealType?: string;
      component?: string | null;
      foods?: any;
      totalCalories?: number;
      macronutrients?: any;
    },
    userId: string,
  ) {
    // Whitelist: sólo persistimos los campos editables provistos. Evita que
    // por el body se puedan pisar userId/timesUsed/lastUsedAt/etc.
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.mealType !== undefined) patch.mealType = data.mealType;
    if (data.component !== undefined) patch.component = data.component;
    if (data.foods !== undefined) patch.foods = data.foods;
    if (data.totalCalories !== undefined) patch.totalCalories = data.totalCalories;
    if (data.macronutrients !== undefined)
      patch.macronutrients = data.macronutrients;

    return this.prisma.savedMeal.updateMany({
      where: { id, userId },
      data: patch,
    });
  }
}
