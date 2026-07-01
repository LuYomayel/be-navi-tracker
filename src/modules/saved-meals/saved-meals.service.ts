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
