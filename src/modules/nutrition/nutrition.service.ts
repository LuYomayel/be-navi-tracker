import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { NutritionAnalysis } from '../../common/types';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class NutritionService {
  constructor(private prisma: PrismaService) {}

  async getAll(userId: string): Promise<NutritionAnalysis[]> {
    try {
      const analyses = await this.prisma.nutritionAnalysis.findMany({
        orderBy: { createdAt: 'desc' },
        where: { userId },
      });
      return analyses as any[];
    } catch (error) {
      console.error('Error fetching nutrition analyses:', error);
      return [];
    }
  }

  async getByDate(date: string, userId: string): Promise<NutritionAnalysis[]> {
    try {
      const analyses = await this.prisma.nutritionAnalysis.findMany({
        where: { date, userId },
        orderBy: { createdAt: 'desc' },
      });
      return analyses as any[];
    } catch (error) {
      console.error('Error fetching nutrition analyses by date:', error);
      return [];
    }
  }

  async create(
    data: Omit<NutritionAnalysis, 'id' | 'createdAt' | 'updatedAt'>,
    userId: string,
  ): Promise<NutritionAnalysis> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...payload } = data as any;
      const prismaData: any = {
        ...payload,
        userId: userId,
        foods: JSON.parse(JSON.stringify(payload.foods)),
        macronutrients: JSON.parse(JSON.stringify(payload.macronutrients)),
        userAdjustments: payload.userAdjustments
          ? JSON.parse(JSON.stringify(payload.userAdjustments))
          : undefined,
      };

      const created = await this.prisma.nutritionAnalysis.create({
        data: prismaData,
      });
      // Reconstituir tipos
      const analysis: NutritionAnalysis = {
        ...created,
        foods: payload.foods,
        macronutrients: payload.macronutrients,
        userAdjustments: payload.userAdjustments,
      };
      return analysis;
    } catch (error) {
      console.error('Error creating nutrition analysis:', error);
      throw new Error('Failed to create nutrition analysis');
    }
  }

  async update(
    id: string,
    data: NutritionAnalysis,
  ): Promise<NutritionAnalysis> {
    try {
      const updated = await this.prisma.nutritionAnalysis.update({
        where: { id },
        data: {
          ...data,
          foods: JSON.parse(JSON.stringify(data.foods)),
          macronutrients: JSON.parse(JSON.stringify(data.macronutrients)),
          userAdjustments: data.userAdjustments
            ? JSON.parse(JSON.stringify(data.userAdjustments))
            : undefined,
        },
      });
      const analysis: NutritionAnalysis = {
        ...updated,
        foods: data.foods,
        macronutrients: data.macronutrients,
        userAdjustments: data.userAdjustments,
      };
      return analysis;
    } catch (error) {
      console.error('Error updating nutrition analysis:', error);
      throw new Error('Failed to update nutrition analysis');
    }
  }

  async delete(id: string, userId: string): Promise<boolean> {
    try {
      await this.prisma.nutritionAnalysis.delete({
        where: { id, userId },
      });
      return true;
    } catch (error) {
      console.error('Error deleting nutrition analysis:', error);
      return false;
    }
  }

  // Necesito chequear que el usuario no se haya pasado de las macros de la dieta
  // Devolver los valores de las macros de la dieta del dia y el progreso del dia
  // Tambien devolver si se paso o no (true o false)
  // ⏰ Corre todos los días a las 00:00 (hora Buenos Aires)
  async updateNutritionAnalysis() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = new Date().toISOString().split('T')[0]; // Por ahora usamos hoy

      const result = await this.checkDailyNutritionGoals(
        'usr_test_id_123',
        dateStr,
      );

      console.log('✅ Evaluación nutricional diaria:', result);

      return result; // Devolver para controlador si lo necesita
    } catch (error) {
      console.error('Error updating nutrition analysis:', error);
      throw new Error('Failed to update nutrition analysis');
    }
  }

  /**
   * Verifica si el usuario cumplió sus objetivos nutricionales para la fecha dada.
   * Devuelve un objeto con:
   *  - meetsGoals: boolean
   *  - totals: { calories, protein, carbs, fat, fiber }
   */
  async checkDailyNutritionGoals(
    userId: string,
    date: string,
  ): Promise<{ meetsGoals: boolean; totals: Record<string, number> }> {
    // 1. Traer preferencias del usuario
    const preferences = await this.prisma.userPreferences.findUnique({
      where: { userId },
    });

    if (!preferences) {
      throw new Error('User preferences not found');
    }

    // 2. Traer todos los análisis de la fecha indicada
    const analyses = await this.prisma.nutritionAnalysis.findMany({
      where: { userId, date },
    });

    // 3. Sumar totales consumidos
    const totals = analyses.reduce(
      (acc, analysis) => {
        acc.calories += analysis.totalCalories || 0;
        acc.protein += (analysis.macronutrients as any)?.protein || 0;
        acc.carbs += (analysis.macronutrients as any)?.carbs || 0;
        acc.fat += (analysis.macronutrients as any)?.fat || 0;
        acc.fiber += (analysis.macronutrients as any)?.fiber || 0;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
    );

    // 4. Comparar con los objetivos (si están definidos)
    const meetsGoals =
      (preferences.dailyCalorieGoal
        ? totals.calories <= preferences.dailyCalorieGoal
        : true) &&
      (preferences.proteinGoal
        ? totals.protein <= preferences.proteinGoal
        : true) &&
      (preferences.carbsGoal ? totals.carbs <= preferences.carbsGoal : true) &&
      (preferences.fatGoal ? totals.fat <= preferences.fatGoal : true) &&
      (preferences.fiberGoal ? totals.fiber <= preferences.fiberGoal : true);

    return { meetsGoals, totals };
  }
}
