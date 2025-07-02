import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import {
  NutritionAnalysis,
  WeightEntry,
  WeightEntryAnalysis,
} from '../../common/types';
import OpenAI from 'openai';
import { CreateWeightEntryManualDto } from './dto/create-weight-entry.dto';

@Injectable()
export class NutritionService {
  private openai: OpenAI | null = null;
  constructor(private prisma: PrismaService) {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  private cleanOpenAIResponse(response: string): string {
    let cleaned = response.trim();

    // Eliminar bloques de código markdown (```json ... ``` o ``` ... ```)
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    return cleaned.trim();
  }

  private validateAndCleanWeightAnalysis(
    analysis: Partial<WeightEntryAnalysis>,
    userId: string,
  ): Omit<WeightEntry, 'id' | 'createdAt' | 'updatedAt'> {
    // Validar que existe el peso
    if (!analysis.weight || analysis.weight <= 0) {
      throw new Error('Peso inválido o no proporcionado');
    }

    // Limpiar y validar datos
    const validatedWeight: Omit<WeightEntry, 'id' | 'createdAt' | 'updatedAt'> =
      {
        userId: userId,
        date: new Date().toISOString().split('T')[0],
        weight: this.clampNumber(analysis.weight, 20, 300, analysis.weight),
        bodyFatPercentage: analysis.bodyFatPercentage
          ? this.clampNumber(
              analysis.bodyFatPercentage,
              5,
              50,
              analysis.bodyFatPercentage,
            )
          : undefined,
        muscleMassPercentage: analysis.muscleMassPercentage
          ? this.clampNumber(
              analysis.muscleMassPercentage,
              20,
              60,
              analysis.muscleMassPercentage,
            )
          : undefined,
        bodyWaterPercentage: analysis.bodyWaterPercentage
          ? this.clampNumber(
              analysis.bodyWaterPercentage,
              30,
              70,
              analysis.bodyWaterPercentage,
            )
          : undefined,
        bmi: analysis.bmi
          ? this.clampNumber(analysis.bmi, 10, 50, analysis.bmi)
          : undefined,
        bfr: analysis.bfr
          ? this.clampNumber(analysis.bfr, 5, 50, analysis.bfr)
          : undefined,
        score: analysis.score || undefined,
        source: analysis.source || 'manual',
        aiConfidence: analysis.aiConfidence || undefined,
        notes: analysis.notes || undefined,
      };

    return validatedWeight;
  }

  private clampNumber(
    value: any,
    min: number,
    max: number,
    defaultValue: number,
  ): number {
    if (typeof value !== 'number' || isNaN(value)) {
      return defaultValue;
    }
    return Math.max(min, Math.min(max, value));
  }

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

  async checkDailyNutritionGoals(
    userId: string,
    date: string,
  ): Promise<{ meetsGoals: boolean; totals: Record<string, number> }> {
    // Obtener balance nutricional del día (comidas - actividades)
    const balance = await this.getDailyNutritionBalance(userId, date);
    const physicalActivities = await this.prisma.physicalActivity.findMany({
      where: { userId, date },
    });
    const totalKcal = physicalActivities.reduce(
      (acc, activity) => acc + (activity.activeEnergyKcal || 0),
      0,
    );

    // Comparar con los objetivos usando las calorías netas
    const meetsGoals =
      (balance.goals.dailyCalorieGoal
        ? balance.netCalories - totalKcal <= balance.goals.dailyCalorieGoal
        : true) &&
      (balance.goals.proteinGoal
        ? balance.consumed.protein <= balance.goals.proteinGoal
        : true) &&
      (balance.goals.carbsGoal
        ? balance.consumed.carbs <= balance.goals.carbsGoal
        : true) &&
      (balance.goals.fatGoal
        ? balance.consumed.fat <= balance.goals.fatGoal
        : true) &&
      (balance.goals.fiberGoal
        ? balance.consumed.fiber <= balance.goals.fiberGoal
        : true);

    return {
      meetsGoals,
      totals: {
        calories: balance.netCalories,
        protein: balance.consumed.protein,
        carbs: balance.consumed.carbs,
        fat: balance.consumed.fat,
        fiber: balance.consumed.fiber,
      },
    };
  }
  async getDailyNutritionBalance(userId: string, date: string) {
    // 1. Traer preferencias del usuario
    const preferences = await this.prisma.userPreferences.findUnique({
      where: { userId },
    });

    if (!preferences) {
      throw new Error('User preferences not found');
    }

    // 2. Traer análisis nutricionales del día
    const nutritionAnalyses = await this.prisma.nutritionAnalysis.findMany({
      where: { userId, date },
    });

    // 3. Traer actividades físicas del día
    const physicalActivities = await this.prisma.physicalActivity.findMany({
      where: { userId, date },
    });

    // 4. Calcular totales consumidos
    const consumed = nutritionAnalyses.reduce(
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

    // 5. Calcular totales quemados
    const burned = physicalActivities.reduce(
      (acc, activity) => {
        acc.calories += activity.activeEnergyKcal || 0;
        acc.steps += activity.steps || 0;
        acc.distanceKm += activity.distanceKm || 0;
        acc.exerciseMinutes += activity.exerciseMinutes || 0;
        return acc;
      },
      { calories: 0, steps: 0, distanceKm: 0, exerciseMinutes: 0 },
    );

    // 6. Calcular balance neto
    const netCalories = consumed.calories - burned.calories;

    return {
      consumed,
      burned,
      netCalories,
      goals: {
        dailyCalorieGoal: preferences.dailyCalorieGoal || 2000,
        proteinGoal: preferences.proteinGoal || 120,
        carbsGoal: preferences.carbsGoal || 200,
        fatGoal: preferences.fatGoal || 70,
        fiberGoal: preferences.fiberGoal || 25,
      },
      nutritionAnalyses,
      physicalActivities,
    };
  }

  // Weight Entry CRUD
  async getAllWeightEntries(userId: string): Promise<WeightEntry[]> {
    try {
      const entries = await this.prisma.weightEntry.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      return entries as any[];
    } catch (error) {
      console.error('Error fetching weight entries:', error);
      return [];
    }
  }

  async getWeightEntriesByDate(
    date: string,
    userId: string,
  ): Promise<WeightEntry[]> {
    try {
      const entries = await this.prisma.weightEntry.findMany({
        orderBy: { createdAt: 'desc' },
        where: { date, userId },
      });
      return entries as any[];
    } catch (error) {
      console.error('Error fetching weight entries by date:', error);
      return [];
    }
  }

  async getWeightEntryById(
    id: string,
    userId: string,
  ): Promise<WeightEntry | null> {
    try {
      const entry = await this.prisma.weightEntry.findFirst({
        where: { id, userId },
      });
      return entry as any;
    } catch (error) {
      console.error('Error fetching weight entry by id:', error);
      return null;
    }
  }

  async updateWeightEntry(
    id: string,
    data: Partial<WeightEntry>,
    userId: string,
  ): Promise<WeightEntry | null> {
    try {
      const updated = await this.prisma.weightEntry.update({
        where: { id, userId },
        data: {
          weight: data.weight,
          bodyFatPercentage: data.bodyFatPercentage,
          muscleMassPercentage: data.muscleMassPercentage,
          bodyWaterPercentage: data.bodyWaterPercentage,
          bmi: data.bmi,
          bfr: data.bfr,
          score: data.score,
          notes: data.notes,
          updatedAt: new Date(),
        },
      });
      return updated as any;
    } catch (error) {
      console.error('Error updating weight entry:', error);
      return null;
    }
  }

  async deleteWeightEntry(id: string, userId: string): Promise<boolean> {
    try {
      await this.prisma.weightEntry.delete({
        where: { id, userId },
      });
      return true;
    } catch (error) {
      console.error('Error deleting weight entry:', error);
      return false;
    }
  }

  async getWeightStats(
    userId: string,
    timeframe: 'week' | 'month' | 'year' = 'month',
  ) {
    try {
      const now = new Date();
      let startDate: Date;

      switch (timeframe) {
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
      }

      const entries = await this.prisma.weightEntry.findMany({
        where: {
          userId,
          createdAt: {
            gte: startDate,
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (entries.length === 0) {
        return {
          totalEntries: 0,
          averageWeight: 0,
          minWeight: 0,
          maxWeight: 0,
          weightRange: 0,
          averageBMI: 0,
          averageBFR: 0,
          timeframe,
          trend: 'stable' as const,
          weightChange: 0,
          weightChangePercentage: 0,
        };
      }

      const weights = entries.map((e) => e.weight);
      const bmis = entries.filter((e) => e.bmi).map((e) => e.bmi!);
      const bfrs = entries.filter((e) => e.bfr).map((e) => e.bfr!);

      const totalEntries = entries.length;
      const averageWeight = weights.reduce((a, b) => a + b, 0) / totalEntries;
      const minWeight = Math.min(...weights);
      const maxWeight = Math.max(...weights);
      const weightRange = maxWeight - minWeight;
      const averageBMI =
        bmis.length > 0 ? bmis.reduce((a, b) => a + b, 0) / bmis.length : 0;
      const averageBFR =
        bfrs.length > 0 ? bfrs.reduce((a, b) => a + b, 0) / bfrs.length : 0;

      // Calcular tendencia
      const firstWeight = entries[0].weight;
      const lastWeight = entries[entries.length - 1].weight;
      const weightChange = lastWeight - firstWeight;
      const weightChangePercentage = (weightChange / firstWeight) * 100;

      let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
      if (Math.abs(weightChangePercentage) > 2) {
        trend = weightChangePercentage > 0 ? 'increasing' : 'decreasing';
      }

      return {
        totalEntries,
        averageWeight: Math.round(averageWeight * 100) / 100,
        minWeight,
        maxWeight,
        weightRange: Math.round(weightRange * 100) / 100,
        averageBMI: Math.round(averageBMI * 100) / 100,
        averageBFR: Math.round(averageBFR * 100) / 100,
        timeframe,
        trend,
        weightChange: Math.round(weightChange * 100) / 100,
        weightChangePercentage: Math.round(weightChangePercentage * 100) / 100,
      };
    } catch (error) {
      console.error('Error calculating weight stats:', error);
      return null;
    }
  }

  async getWeightAnalysis(userId: string) {
    try {
      const preferences = await this.prisma.userPreferences.findUnique({
        where: { userId },
      });

      const recentEntries = await this.prisma.weightEntry.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      if (recentEntries.length === 0) {
        return null;
      }

      const currentEntry = recentEntries[0];
      const previousEntry = recentEntries[1] || null;

      const currentWeight = currentEntry.weight;
      const previousWeight = previousEntry?.weight;
      const weightChange = previousWeight ? currentWeight - previousWeight : 0;
      const weightChangePercentage = previousWeight
        ? (weightChange / previousWeight) * 100
        : 0;

      const bmiChange =
        previousEntry?.bmi && currentEntry.bmi
          ? currentEntry.bmi - previousEntry.bmi
          : 0;

      const bfrChange =
        previousEntry?.bfr && currentEntry.bfr
          ? currentEntry.bfr - previousEntry.bfr
          : 0;

      // Determinar tendencia
      let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
      if (Math.abs(weightChangePercentage) > 1) {
        trend = weightChangePercentage > 0 ? 'increasing' : 'decreasing';
      }

      // Clasificación BMI
      let classification: 'underweight' | 'normal' | 'overweight' | 'obese' =
        'normal';
      if (currentEntry.bmi) {
        if (currentEntry.bmi < 18.5) classification = 'underweight';
        else if (currentEntry.bmi >= 25 && currentEntry.bmi < 30)
          classification = 'overweight';
        else if (currentEntry.bmi >= 30) classification = 'obese';
      }

      // Progreso hacia objetivo
      const targetWeight = preferences?.targetWeight;
      let progressToTarget = 0;
      if (targetWeight && previousWeight) {
        const totalWeightToLose = Math.abs(previousWeight - targetWeight);
        const weightLost = Math.abs(previousWeight - currentWeight);
        progressToTarget =
          totalWeightToLose > 0 ? (weightLost / totalWeightToLose) * 100 : 0;
      }

      return {
        currentWeight,
        previousWeight,
        weightChange: Math.round(weightChange * 100) / 100,
        weightChangePercentage: Math.round(weightChangePercentage * 100) / 100,
        bmiChange: Math.round(bmiChange * 100) / 100,
        bfrChange: Math.round(bfrChange * 100) / 100,
        trend,
        period: 'day' as const,
        classification,
        targetWeight,
        progressToTarget: Math.round(progressToTarget * 100) / 100,
      };
    } catch (error) {
      console.error('Error calculating weight analysis:', error);
      return null;
    }
  }
  async analyzeWeightImage(imageBase64: string, userId: string): Promise<any> {
    if (!this.openai) {
      console.log('OpenAI no disponible, usando análisis de fallback');
      return null;
    }

    try {
      // Generar prompt especializado para análisis de comida
      const prompt =
        'Analizame el screenshot de la balanza y me devuelvas los datos de la balanza';

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `Simplemente vas a analizar la imagen y me vas a devolver un JSON con los datos de la balanza.
            La estructura del json debe ser la siguiente:
            {
              weight: number; // kg
              bodyFatPercentage?: number; // %
              muscleMassPercentage?: number; // %
              bodyWaterPercentage?: number; // %
              bmi?: number;
              bfr?: number; // Body Fat Rate
              score?: number; // Score general de la balanza
              imageUrl?: string; // Foto de la balanza (opcional)
              source: 'manual' | 'photo' | 'scale'; // Cómo se registró
              aiConfidence?: number; // Si se usó AI para detectar desde foto
              notes?: string;
            }
            El peso debe ser el peso actual de la balanza.
            El bodyFatPercentage, muscleMassPercentage, bodyWaterPercentage, bmi, bfr, score, source, aiConfidence y notes son opcionales.
            El source debe ser 'photo' si es una foto de la balanza.
            El aiConfidence debe ser un número entre 0 y 1.
            El notes debe ser un string con las notas de la balanza.
            `,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64,
                  detail: 'high',
                },
              },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0.2, // Muy conservador para análisis nutricional preciso
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No se recibió respuesta de OpenAI Vision');
      }

      // Limpiar y parsear la respuesta JSON
      const cleanedResponse = this.cleanOpenAIResponse(response);
      let parsed;
      try {
        parsed = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error(
          'Error parseando respuesta de OpenAI Vision:',
          parseError,
        );
        console.log('Respuesta original recibida:', response);
        console.log('Respuesta limpiada:', cleanedResponse);
        throw new Error('Respuesta de OpenAI Vision no válida');
      }

      // Validar y limpiar la respuesta
      const validatedAnalysis = this.validateAndCleanWeightAnalysis(
        parsed,
        userId,
      );
      console.log('✅ Análisis de peso generado con OpenAI Vision');

      const created = await this.prisma.weightEntry.create({
        data: validatedAnalysis,
      });

      return parsed;
    } catch (error) {
      console.error('Error analizando imagen de peso con OpenAI:', error);
      // Fallback a análisis predefinido
      return null;
    }
  }

  async analyzeWeightManual(
    data: CreateWeightEntryManualDto,
    userId: string,
  ): Promise<any> {
    try {
      const validatedAnalysis = this.validateAndCleanWeightAnalysis(
        data,
        userId,
      );

      const created = await this.prisma.weightEntry.create({
        data: validatedAnalysis,
      });

      return created;
    } catch (error) {
      console.error('Error analizando peso manual con OpenAI:', error);
      return null;
    }
  }
}
