import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { getLocalDateString } from '../../common/utils/date.utils';

@Injectable()
export class SavedMealsService {
  constructor(
    private prisma: PrismaService,
    private nutrition: NutritionService,
  ) {}

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
