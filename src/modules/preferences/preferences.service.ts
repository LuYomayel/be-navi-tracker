import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { UserPreferences } from '../../common/types';

export interface PreferencesDTO {
  height: number;
  currentWeight: number;
  targetWeight: number;
  age: number;
  gender: 'male' | 'female' | 'other';
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  fitnessGoal: string;
  finalGoals: {
    dailyCalories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
}
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

  async getPreferences(userId: string): Promise<UserPreferences | null> {
    try {
      const preferences = await this.prisma.userPreferences.findUnique({
        where: { userId },
      });
      return preferences as UserPreferences;
    } catch (error) {
      console.error('Error getting preferences:', error);
      throw new Error('Failed to get preferences');
    }
  }

  async setPreferences(
    data: PreferencesDTO,
    userId: string,
  ): Promise<UserPreferences> {
    try {
      const userPreferences: Omit<UserPreferences, 'id'> = {
        userId,
        height: data.height,
        currentWeight: data.currentWeight,
        targetWeight: data.targetWeight,
        age: data.age,
        gender: data.gender,
        activityLevel: data.activityLevel,
        fitnessGoals: data.fitnessGoal ? [data.fitnessGoal] : undefined,
        dailyCalorieGoal: data.finalGoals.dailyCalories,
        proteinGoal: data.finalGoals.protein,
        carbsGoal: data.finalGoals.carbs,
        fatGoal: data.finalGoals.fat,
        fiberGoal: 0,
        lastBodyAnalysisId: '',
        bmr: 0,
        tdee: 0,
        preferredUnits: 'metric',
        notifications: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      console.log('🔍 User preferences:', userPreferences);
      // Usar upsert para crear o actualizar evitando conflicto de clave única
      const savedPreferences = await this.prisma.userPreferences.upsert({
        where: { userId },
        create: {
          ...userPreferences,
        },
        update: {
          ...userPreferences,
          updatedAt: new Date(),
        },
      });

      return savedPreferences as UserPreferences;
    } catch (error) {
      console.error('Error setting preferences:', error);
      throw new Error('Failed to set preferences');
    }
  }

  async updateGoals(
    goals: {
      dailyCalorieGoal?: number;
      proteinGoal?: number;
      carbsGoal?: number;
      fatGoal?: number;
    },
    userId: string,
  ): Promise<UserPreferences> {
    try {
      const updatedPreferences = await this.prisma.userPreferences.upsert({
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
      return updatedPreferences as UserPreferences;
    } catch (error) {
      console.error('Error updating goals:', error);
      throw new Error('Failed to update goals');
    }
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
    userId: string,
  ): Promise<UserPreferences> {
    try {
      const updatedPreferences = await this.prisma.userPreferences.upsert({
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
      return updatedPreferences as UserPreferences;
    } catch (error) {
      console.error('Error updating personal data:', error);
      throw new Error('Failed to update personal data');
    }
  }

  async getCurrentGoals(userId: string): Promise<{
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

  async getProgressData(userId: string): Promise<{
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

  async resetPreferences(userId: string): Promise<boolean> {
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
