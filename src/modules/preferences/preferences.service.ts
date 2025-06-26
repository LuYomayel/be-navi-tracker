import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { UserPreferences } from '@prisma/client';

export interface SetPreferencesRequest {
  // Datos personales
  personalData?: {
    height?: number;
    currentWeight?: number;
    targetWeight?: number;
    age?: number;
    gender?: 'male' | 'female' | 'other';
    activityLevel?:
      | 'sedentary'
      | 'light'
      | 'moderate'
      | 'active'
      | 'very_active';
    fitnessGoal?: string;
  };

  // Objetivos nutricionales (ajustados por el usuario)
  nutritionGoals?: {
    dailyCalories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    fiber?: number;
    sodium?: number;
    sugar?: number;
  };

  // Datos del análisis corporal
  bodyAnalysisData?: {
    bodyAnalysisId?: string;
    bodyType?: string;
    confidence?: number;
    measurements?: {
      height?: number;
      weight?: number;
      age?: number;
      gender?: string;
      activityLevel?: string;
      bodyFatPercentage?: number;
      muscleDefinition?: string;
      posture?: string;
      symmetry?: string;
      overallFitness?: string;
    };
    bodyComposition?: {
      estimatedBMI?: number;
      bodyType?: string;
      muscleMass?: string;
      bodyFat?: string;
      metabolism?: string;
      boneDensity?: string;
      muscleGroups?: any[];
    };
    recommendations?: {
      nutrition?: string[];
      priority?: string;
      dailyCalories?: number;
      macroSplit?: {
        protein?: number;
        carbs?: number;
        fat?: number;
      };
      supplements?: string[];
      goals?: string[];
    };
    progress?: {
      strengths?: string[];
      areasToImprove?: string[];
      generalAdvice?: string;
    };
    disclaimer?: string;
    insights?: string[];
  };

  // Metadatos
  metadata?: {
    createdAt?: string;
    source?: string;
    version?: string;
  };

  // Configuraciones adicionales
  preferredUnits?: 'metric' | 'imperial';
  notifications?: any;
}

@Injectable()
export class PreferencesService {
  constructor(private prisma: PrismaService) {}

  async getPreferences(
    userId: string = 'default',
  ): Promise<UserPreferences | null> {
    return this.prisma.userPreferences.findUnique({
      where: { userId },
    });
  }

  async setPreferences(
    data: SetPreferencesRequest,
    userId: string = 'default',
  ): Promise<UserPreferences> {
    // Extraer datos del request
    const personalData = data.personalData || {};
    const nutritionGoals = data.nutritionGoals || {};
    const bodyAnalysisData = data.bodyAnalysisData || {};

    // Preparar los datos para Prisma
    const prismaData = {
      // Datos personales
      height: personalData.height,
      currentWeight: personalData.currentWeight,
      targetWeight: personalData.targetWeight,
      age: personalData.age,
      gender: personalData.gender,
      activityLevel: personalData.activityLevel,

      // Fitness goals
      fitnessGoals: personalData.fitnessGoal
        ? [personalData.fitnessGoal]
        : undefined,

      // Objetivos nutricionales
      dailyCalorieGoal: nutritionGoals.dailyCalories,
      proteinGoal: nutritionGoals.protein,
      carbsGoal: nutritionGoals.carbs,
      fatGoal: nutritionGoals.fat,
      fiberGoal: nutritionGoals.fiber,

      // Metadatos del body analysis
      lastBodyAnalysisId: bodyAnalysisData.bodyAnalysisId,

      // Configuraciones
      preferredUnits: data.preferredUnits || 'metric',
      notifications: data.notifications,
    };

    // Filtrar campos undefined
    const cleanData = Object.fromEntries(
      Object.entries(prismaData).filter(([, value]) => value !== undefined),
    );

    // Usar upsert para crear o actualizar
    return this.prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        ...cleanData,
      },
      update: {
        ...cleanData,
        updatedAt: new Date(),
      },
    });
  }

  async updateGoals(
    goals: {
      dailyCalorieGoal?: number;
      proteinGoal?: number;
      carbsGoal?: number;
      fatGoal?: number;
    },
    userId: string = 'default',
  ): Promise<UserPreferences> {
    return this.prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        ...goals,
      },
      update: {
        ...goals,
        updatedAt: new Date(),
      },
    });
  }

  async updatePersonalData(
    personalData: {
      height?: number;
      currentWeight?: number;
      targetWeight?: number;
      age?: number;
      gender?: string;
      activityLevel?: string;
    },
    userId: string = 'default',
  ): Promise<UserPreferences> {
    return this.prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        ...personalData,
      },
      update: {
        ...personalData,
        updatedAt: new Date(),
      },
    });
  }

  async getCurrentGoals(userId: string = 'default'): Promise<{
    dailyCalorieGoal: number;
    proteinGoal: number;
    carbsGoal: number;
    fatGoal: number;
  } | null> {
    const preferences = await this.getPreferences(userId);

    if (!preferences) {
      return null;
    }

    return {
      dailyCalorieGoal: preferences.dailyCalorieGoal || 2000,
      proteinGoal: preferences.proteinGoal || 120,
      carbsGoal: preferences.carbsGoal || 200,
      fatGoal: preferences.fatGoal || 70,
    };
  }

  async getProgressData(userId: string = 'default'): Promise<{
    currentWeight: number;
    targetWeight: number;
    height: number;
    bmi: number;
    weightToGoal: number;
  } | null> {
    const preferences = await this.getPreferences(userId);

    if (!preferences || !preferences.currentWeight || !preferences.height) {
      return null;
    }

    const heightInM = preferences.height / 100;
    const bmi = preferences.currentWeight / (heightInM * heightInM);
    const weightToGoal = preferences.targetWeight
      ? preferences.currentWeight - preferences.targetWeight
      : 0;

    return {
      currentWeight: preferences.currentWeight,
      targetWeight: preferences.targetWeight || preferences.currentWeight,
      height: preferences.height,
      bmi: Math.round(bmi * 10) / 10,
      weightToGoal: Math.round(weightToGoal * 10) / 10,
    };
  }

  async resetPreferences(userId: string = 'default'): Promise<boolean> {
    try {
      await this.prisma.userPreferences.delete({
        where: { userId },
      });
      return true;
    } catch (error) {
      // Si no existe, consideramos que ya está "reseteado"
      return true;
    }
  }
}
