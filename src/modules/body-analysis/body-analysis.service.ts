import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { BodyAnalysis } from '../../common/types';
import { SaveDTO } from './dto/save-body-analysis.dto';
import OpenAI from 'openai';
import { resolveImageUrl } from '../../common/utils/image.utils';
import { AICostService } from '../ai-cost/ai-cost.service';

export enum BodyType {
  ECTOMORPH = 'ectomorph', // Delgado, dificultad para ganar peso
  MESOMORPH = 'mesomorph', // Atlético, gana músculo fácilmente
  ENDOMORPH = 'endomorph', // Tendencia a acumular grasa, metabolismo lento
}

export enum ActivityLevel {
  SEDENTARY = 'sedentary', // Poco o ningún ejercicio
  LIGHT = 'light', // Ejercicio ligero 1-3 días/semana
  MODERATE = 'moderate', // Ejercicio moderado 3-5 días/semana
  ACTIVE = 'active', // Ejercicio intenso 6-7 días/semana
  VERY_ACTIVE = 'very_active', // Ejercicio muy intenso o trabajo físico
}

export enum NutritionGoal {
  LOSE_FAT = 'lose_fat',
  GAIN_MUSCLE = 'gain_muscle',
  MAINTAIN_WEIGHT = 'maintain_weight',
  IMPROVE_HEALTH = 'improve_health',
  INCREASE_ENERGY = 'increase_energy',
  BETTER_SLEEP = 'better_sleep',
}

export enum MealType {
  BREAKFAST = 'breakfast',
  LUNCH = 'lunch',
  DINNER = 'dinner',
  SNACK = 'snack',
  OTHER = 'other',
}

export interface BodyMeasurements {
  estimatedBodyFat?: number;
  bodyFatPercentage?: number;
  muscleDefinition: 'low' | 'moderate' | 'high' | 'very_high';
  posture: 'needs_attention' | 'fair' | 'good' | 'excellent';
  symmetry: 'needs_attention' | 'fair' | 'good' | 'excellent';
  overallFitness: 'beginner' | 'intermediate' | 'advanced' | 'athlete';
  age?: number;
  gender?: 'male' | 'female' | 'other';
  activityLevel?: ActivityLevel;
  goals?: string[];
  height?: number;
  weight?: number;
  waist?: number;
  chest?: number;
  hips?: number;
}

export interface BodyComposition {
  estimatedBMI?: number;
  bodyType: BodyType;
  muscleMass: 'low' | 'medium' | 'high';
  bodyFat: 'low' | 'medium' | 'high';
  metabolism: 'slow' | 'medium' | 'fast';
  boneDensity: 'light' | 'medium' | 'heavy';
  muscleGroups: Array<{
    name: string;
    development:
      | 'underdeveloped'
      | 'developing'
      | 'well_developed'
      | 'good'
      | 'excellent'
      | 'highly_developed';
    recommendations: string[];
  }>;
}

export interface MealTiming {
  mealType: MealType;
  timeWindow: string; // "7:00-9:00", "12:00-14:00"
  caloriePercentage: number; // % del total diario
  macroFocus: 'protein' | 'carbs' | 'balanced';
}

export interface NutritionRecommendations {
  nutrition: string[];
  priority:
    | 'cardio'
    | 'strength'
    | 'flexibility'
    | 'balance'
    | 'general_fitness';
  dailyCalories?: number;
  macroSplit?: {
    protein: number; // %
    carbs: number; // %
    fat: number; // %
  };
  //mealTiming: MealTiming[];
  supplements?: string[];
  restrictions?: string[];
  goals: NutritionGoal[];
}

export interface BodyAnalysisApiResponse {
  bodyType: BodyType;
  bodyComposition: BodyComposition;
  measurements: BodyMeasurements;
  recommendations: NutritionRecommendations;
  progress: {
    strengths: string[];
    areasToImprove: string[];
    generalAdvice: string;
  };
  confidence: number;
  disclaimer: string;
  insights?: string[];
}

@Injectable()
export class BodyAnalysisService {
  private openai: OpenAI | null = null;

  constructor(
    private prisma: PrismaService,
    private aiCostService: AICostService,
  ) {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  async getAll(): Promise<BodyAnalysis[]> {
    try {
      const results = await this.prisma.bodyAnalysis.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return results as any[];
    } catch (error) {
      console.error('Error al obtener análisis corporales:', error);
      return [];
    }
  }

  async getById(id: string): Promise<BodyAnalysis | null> {
    try {
      const result = await this.prisma.bodyAnalysis.findUnique({
        where: { id },
      });
      return result as any;
    } catch (error) {
      console.error('Error al obtener análisis corporal por id:', error);
      return null;
    }
  }

  async save(dto: SaveDTO, userId: string): Promise<BodyAnalysis> {
    try {
      // Preparar datos para persistir
      const analysisToSave: Omit<
        BodyAnalysis,
        'id' | 'createdAt' | 'updatedAt'
      > = {
        userId,
        bodyType: dto.bodyType,
        measurements:
          dto.fullAnalysisData?.measurements || (dto.measurements as any),
        bodyComposition: dto.fullAnalysisData?.bodyComposition || {},
        recommendations:
          dto.fullAnalysisData?.recommendations || dto.recommendations || {},
        progress: dto.fullAnalysisData?.progress || {},
        insights: dto.fullAnalysisData?.insights || [],
        disclaimer: dto.fullAnalysisData?.disclaimer || '',
        aiConfidence: dto.confidence || 0,
      } as any;

      const analysis = await this.create(analysisToSave);
      return analysis;
    } catch (error) {
      console.error('Error al guardar análisis corporal:', error);
      throw new Error('Error al guardar análisis corporal');
    }
  }

  async create(
    data: Omit<BodyAnalysis, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<BodyAnalysis> {
    try {
      const analysis = await this.prisma.bodyAnalysis.create({
        data: {
          userId: data.userId || 'default',
          bodyType: data.bodyType,
          measurements: data.measurements
            ? JSON.parse(JSON.stringify(data.measurements))
            : {},
          bodyComposition: data.bodyComposition
            ? JSON.parse(JSON.stringify(data.bodyComposition))
            : {},
          recommendations: data.recommendations
            ? JSON.parse(JSON.stringify(data.recommendations))
            : {},
          imageUrl: data.imageUrl || null,
          aiConfidence: data.aiConfidence || 0.0,
          insights: data.insights || [],
          disclaimer: data.disclaimer || '',
          progress: data.progress || {},
          rawAnalysis: data.rawAnalysis || {},
        },
      });
      return analysis as any;
    } catch (error) {
      console.error('Error al crear análisis corporal:', error);
      throw new Error('Error al crear análisis corporal');
    }
  }

  async update(
    id: string,
    data: Partial<Omit<BodyAnalysis, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<BodyAnalysis | null> {
    try {
      const updateData: any = {
        updatedAt: new Date(),
      };

      if (data.userId) updateData.userId = data.userId;
      if (data.bodyType) updateData.bodyType = data.bodyType;
      if (data.measurements)
        updateData.measurements = JSON.parse(JSON.stringify(data.measurements));
      if (data.bodyComposition)
        updateData.bodyComposition = JSON.parse(
          JSON.stringify(data.bodyComposition),
        );
      if (data.recommendations)
        updateData.recommendations = JSON.parse(
          JSON.stringify(data.recommendations),
        );
      if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
      if (data.aiConfidence !== undefined)
        updateData.aiConfidence = data.aiConfidence;

      const analysis = await this.prisma.bodyAnalysis.update({
        where: { id },
        data: updateData,
      });
      return analysis as any;
    } catch (error) {
      console.error('Error al actualizar análisis corporal:', error);
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.bodyAnalysis.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      console.error('Error al eliminar análisis corporal:', error);
      return false;
    }
  }

  async getLatest(): Promise<BodyAnalysis | null> {
    try {
      const result = await this.prisma.bodyAnalysis.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      return result as any;
    } catch (error) {
      console.error('Error al obtener último análisis corporal:', error);
      return null;
    }
  }

  async getRecentAnalyses(days: number = 30): Promise<BodyAnalysis[]> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const results = await this.prisma.bodyAnalysis.findMany({
        where: {
          createdAt: {
            gte: cutoffDate,
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      return results as any[];
    } catch (error) {
      console.error('Error al obtener análisis corporales recientes:', error);
      return [];
    }
  }

  /**
   * Analiza una imagen corporal usando OpenAI Vision y devuelve el resultado.
   * Reemplaza el viejo flujo basado en Redis/BullMQ tasks.
   */
  async analyzeBody(
    data: {
      image: string;
      currentWeight?: number;
      targetWeight?: number;
      height?: number;
      age?: number;
      gender?: 'male' | 'female' | 'other';
      activityLevel?: string;
      goals?: string[];
    },
    userId: string,
  ): Promise<BodyAnalysisApiResponse> {
    if (!this.openai) {
      throw new Error('OpenAI no está configurado. Falta OPENAI_API_KEY.');
    }

    const imageUrl = resolveImageUrl(data.image);

    const personalContext = [
      data.age ? `Edad: ${data.age} años` : '',
      data.gender ? `Género: ${data.gender}` : '',
      data.height ? `Altura: ${data.height} cm` : '',
      data.currentWeight ? `Peso actual: ${data.currentWeight} kg` : '',
      data.targetWeight ? `Peso objetivo: ${data.targetWeight} kg` : '',
      data.activityLevel ? `Nivel de actividad: ${data.activityLevel}` : '',
      data.goals?.length ? `Objetivos: ${data.goals.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const prompt = `Eres un experto en fitness y análisis corporal. Analiza la siguiente imagen corporal y proporciona un análisis detallado.

Datos personales del usuario:
${personalContext}

Responde EXCLUSIVAMENTE con un JSON válido (sin markdown, sin \`\`\`, sin texto extra) con esta estructura exacta:

{
  "bodyType": "ectomorph" | "mesomorph" | "endomorph",
  "bodyComposition": {
    "estimatedBMI": number | null,
    "bodyType": "ectomorph" | "mesomorph" | "endomorph",
    "muscleMass": "low" | "medium" | "high",
    "bodyFat": "low" | "medium" | "high",
    "metabolism": "slow" | "medium" | "fast",
    "boneDensity": "light" | "medium" | "heavy",
    "muscleGroups": [
      {
        "name": "string (nombre del grupo muscular)",
        "development": "underdeveloped" | "developing" | "well_developed" | "good" | "excellent" | "highly_developed",
        "recommendations": ["string"]
      }
    ]
  },
  "measurements": {
    "bodyFatPercentage": number | null,
    "muscleDefinition": "low" | "moderate" | "high" | "very_high",
    "posture": "needs_attention" | "fair" | "good" | "excellent",
    "symmetry": "needs_attention" | "fair" | "good" | "excellent",
    "overallFitness": "beginner" | "intermediate" | "advanced" | "athlete"
  },
  "recommendations": {
    "nutrition": ["string (recomendaciones nutricionales)"],
    "priority": "cardio" | "strength" | "flexibility" | "balance" | "general_fitness",
    "dailyCalories": number,
    "macroSplit": { "protein": number, "carbs": number, "fat": number },
    "supplements": ["string"],
    "goals": ["lose_fat" | "gain_muscle" | "maintain_weight" | "improve_health" | "increase_energy" | "better_sleep"]
  },
  "progress": {
    "strengths": ["string"],
    "areasToImprove": ["string"],
    "generalAdvice": "string"
  },
  "confidence": number (0-1),
  "disclaimer": "string (disclaimer médico)",
  "insights": ["string (observaciones adicionales)"]
}

Analiza los grupos musculares visibles (pecho, hombros, brazos, abdomen, espalda, piernas, etc.) y da recomendaciones específicas para cada uno.
Si no puedes determinar un valor con certeza, usa estimaciones conservadoras y un confidence más bajo.
Las calorías y macros deben ser coherentes con los datos personales y objetivos del usuario.`;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'high' },
            },
          ],
        },
      ],
      max_tokens: 4000,
      temperature: 0.3,
    });

    // Log AI cost
    try {
      await this.aiCostService.logFromCompletion(
        userId,
        'body-analysis-image',
        completion,
      );
    } catch (e) {
      console.error('Error logging AI cost for body-analysis:', e);
    }

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI no devolvió contenido en la respuesta');
    }

    // Limpiar posibles backticks de markdown
    const cleanedContent = content
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    try {
      const parsed = JSON.parse(cleanedContent) as BodyAnalysisApiResponse;
      return parsed;
    } catch (parseError) {
      console.error('Error parseando respuesta de OpenAI:', cleanedContent);
      throw new Error('Error parseando la respuesta del análisis corporal');
    }
  }

}
