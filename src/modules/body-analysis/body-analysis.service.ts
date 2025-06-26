import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { BodyAnalysis } from '../../common/types';
import OpenAI from 'openai';

interface BodyAnalysisRequest {
  image: string; // Base64 encoded image
  currentWeight?: number;
  targetWeight?: number;
  height?: number;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goals?: string[];
  allowGeneric?: boolean;
}

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

  constructor(private prisma: PrismaService) {
    // Inicializar OpenAI solo si hay API key
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  // Función helper para limpiar respuestas de OpenAI que pueden venir con markdown
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

  async getAll(): Promise<BodyAnalysis[]> {
    try {
      const results = await this.prisma.bodyAnalysis.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return results as any[];
    } catch (error) {
      console.error('Error fetching body analyses:', error);
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
      console.error('Error fetching body analysis by id:', error);
      return null;
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
        },
      });
      return analysis as any;
    } catch (error) {
      console.error('Error creating body analysis:', error);
      throw new Error('Failed to create body analysis');
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
      console.error('Error updating body analysis:', error);
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
      console.error('Error deleting body analysis:', error);
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
      console.error('Error fetching latest body analysis:', error);
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
      console.error('Error fetching recent body analyses:', error);
      return [];
    }
  }

  async analyzeBodyImage(
    imageBase64: string,
    userData: Omit<BodyAnalysisRequest, 'image'>,
  ): Promise<BodyAnalysisApiResponse> {
    if (!this.openai) {
      console.log('OpenAI no disponible, usando análisis de fallback');
      return null;
    }

    try {
      // Generar prompt especializado para análisis corporal
      const prompt = this.generateBodyAnalysisPrompt(userData);

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `Eres un asistente de fitness y wellness que ayuda a las personas a mejorar su forma física de manera general. Tu tarea es proporcionar consejos generales de fitness basados en información visual, siempre de forma educativa y motivacional.

REGLAS IMPORTANTES:
1. Proporciona solo consejos generales de fitness y wellness
2. No hagas diagnósticos médicos ni evaluaciones clínicas
3. Enfócate en aspectos generales de forma física y estilo de vida saludable
4. Sé motivacional y constructivo en tus comentarios
5. Incluye disclaimers sobre la naturaleza general de los consejos
6. Recomienda consultar profesionales cuando sea apropiado`,
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
        temperature: 0.3, // Más conservador para análisis médico/fitness
      });

      // 2. SUSTITUYE el bloque inmediatamente después de obtener `response` en analyzeBodyImage()
      const raw = completion.choices[0]?.message?.content?.trim();
      const response = completion.choices[0]?.message?.content;
      console.log('Respuesta original recibida:', response);

      if (!raw || !this.isJson(raw)) {
        console.warn('OpenAI refusal o respuesta no-JSON:', raw);
        return null; // ⬅️  fallback técnico
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
      const validatedAnalysis = this.validateAndCleanBodyAnalysis(
        parsed,
        userData,
      );
      // A partir del analisis de la imagen, se llama a la API de OpenAI para realizar una recomendacion nutricional mas especifica
      const nutritionRecommendation =
        await this.generateNutritionRecommendation(validatedAnalysis);

      if (!nutritionRecommendation) {
        throw new Error(
          'No se recibió respuesta de OpenAI para recomendaciones nutricionales',
        );
      }
      console.log(
        '✅ Análisis corporal generado con OpenAI Vision',
        nutritionRecommendation,
      );
      const analysis = {
        ...validatedAnalysis,
        recommendations: nutritionRecommendation,
      };
      return analysis;
    } catch (error) {
      console.error('Error analizando imagen corporal con OpenAI:', error);
      // Fallback a análisis predefinido
      return null;
    }
  }

  private async generateNutritionRecommendation(
    validatedAnalysis: BodyAnalysisApiResponse,
  ): Promise<NutritionRecommendations> {
    const prompt =
      this.generateNutritionRecommendationPrompt(validatedAnalysis);
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2, // Más conservador para análisis nutricional
      max_tokens: 1500,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error(
        'No se recibió respuesta de OpenAI para recomendaciones nutricionales',
      );
    }

    // Limpiar y parsear la respuesta JSON
    const cleanedResponse = this.cleanOpenAIResponse(response);
    try {
      return JSON.parse(cleanedResponse) as NutritionRecommendations;
    } catch (parseError) {
      console.error(
        'Error parseando recomendaciones nutricionales de OpenAI:',
        parseError,
      );
      return null;
    }
  }

  private generateNutritionRecommendationPrompt(
    validatedAnalysis: BodyAnalysisApiResponse,
  ): string {
    const objetivo = validatedAnalysis.measurements.goals?.[0] || 'maintain';
    const bmi = validatedAnalysis.bodyComposition.estimatedBMI || 25;
    const peso = validatedAnalysis.measurements.weight || 70;
    const altura = validatedAnalysis.measurements.height || 170;
    const edad = validatedAnalysis.measurements.age || 25;
    const genero = validatedAnalysis.measurements.gender || 'male';
    const actividadLevel =
      validatedAnalysis.measurements.activityLevel || 'moderate';

    return `
Eres un nutricionista deportivo especializado con 15 años de experiencia. Proporciona un análisis técnico y específico basado en los datos corporales y objetivos del cliente.

DATOS DEL CLIENTE:
- Edad: ${edad} años, Género: ${genero}
- Altura: ${altura}cm, Peso: ${peso}kg, BMI: ${bmi}
- Nivel actividad: ${actividadLevel}
- Objetivo principal: ${objetivo}
- Tipo corporal: ${validatedAnalysis.bodyType}
- % Grasa corporal estimado: ${validatedAnalysis.measurements.bodyFatPercentage}%
- Masa muscular: ${validatedAnalysis.bodyComposition.muscleMass}
- Metabolismo: ${validatedAnalysis.bodyComposition.metabolism}

INSTRUCCIONES ESPECÍFICAS POR OBJETIVO:
${this.getObjectiveSpecificInstructions(objetivo)}

REQUERIMIENTOS DE RESPUESTA:
1. Consejos nutricionales TÉCNICOS y ESPECÍFICOS (no genéricos)
2. Macros calculadas según objetivo y composición corporal
3. Suplementos basados en déficits nutricionales reales
4. Restricciones específicas según objetivo
5. Prioridad de entrenamiento alineada al objetivo
6. TODO EN ESPAÑOL

IMPORTANTE: Responde ÚNICAMENTE con un JSON válido, sin bloques de código markdown, sin explicaciones adicionales. Solo el JSON puro:
{
  "nutrition": ["consejo_técnico_específico_1", "estrategia_nutricional_2", "protocolo_específico_3"],
  "priority": "cardio|strength|flexibility|balance|general_fitness",
  "dailyCalories": calorías_calculadas_específicas,
  "macroSplit": {
    "protein": porcentaje_específico_objetivo,
    "carbs": porcentaje_específico_objetivo,
    "fat": porcentaje_específico_objetivo
  },
  "supplements": ["suplemento1_específico", "suplemento2_específico"],
  "restrictions": ["restricción1_específica", "restricción2_específica"],
  "goals": ["objetivo_primario", "objetivo_secundario"]
}
  `;
  }

  private getObjectiveSpecificInstructions(objetivo: string): string {
    switch (objetivo) {
      case 'define':
        return `
OBJETIVO: DEFINICIÓN MUSCULAR
- Déficit calórico de 300-500 kcal/día
- Proteína: 35-40% (1.8-2.2g/kg peso corporal)
- Carbohidratos: 25-30% (timing pre/post entrenamiento)
- Grasas: 30-35% (énfasis en omega-3 y MCT)
- Prioridad: Strength + Cardio HIIT
- Suplementos: L-Carnitina, CLA, Proteína isolada
- Restricciones: Carbohidratos refinados, sodio excesivo`;

      case 'bulk':
        return `
OBJETIVO: GANANCIA DE MASA MUSCULAR
- Superávit calórico de 300-500 kcal/día
- Proteína: 25-30% (1.6-2.0g/kg peso corporal)
- Carbohidratos: 45-50% (énfasis en complejos)
- Grasas: 20-25%
- Prioridad: Strength + volumen
- Suplementos: Creatina, Proteína whey, Maltodextrina
- Restricciones: Grasas trans, alcohol`;

      case 'lose_weight':
        return `
OBJETIVO: PÉRDIDA DE PESO
- Déficit calórico de 500-750 kcal/día
- Proteína: 30-35% (preservar masa muscular)
- Carbohidratos: 30-35% (bajo IG)
- Grasas: 30-35%
- Prioridad: Cardio + Strength
- Suplementos: Fibra, L-Carnitina, Multivitamínico
- Restricciones: Azúcares añadidos, procesados`;

      case 'gain_muscle':
        return `
OBJETIVO: GANANCIA MUSCULAR LIMPIA
- Superávit calórico moderado 200-300 kcal/día
- Proteína: 30-35% (1.8-2.2g/kg peso corporal)
- Carbohidratos: 35-40% (timing específico)
- Grasas: 25-30%
- Prioridad: Strength + hipertrofia
- Suplementos: Creatina, HMB, Proteína caseína
- Restricciones: Comida chatarra, alcohol`;

      default:
        return `
OBJETIVO: MANTENIMIENTO Y SALUD GENERAL
- Calorías de mantenimiento
- Proteína: 25-30%
- Carbohidratos: 40-45%
- Grasas: 25-30%
- Prioridad: General fitness
- Suplementos: Multivitamínico, Omega-3
- Restricciones: Procesados excesivos`;
    }
  }

  private getSmartNutritionFallback(
    objetivo: string,
  ): NutritionRecommendations {
    switch (objetivo) {
      case 'define':
        return {
          nutrition: [
            'Déficit calórico de 300-500 kcal mediante ciclado de carbohidratos',
            'Proteína de 1.8-2.2g/kg peso corporal distribuida en 4-5 tomas',
            'Carbohidratos complejos solo pre/post entreno (25-30% del total)',
            'Grasas saludables 30-35%: omega-3, MCT, frutos secos',
            'Ayuno intermitente 16:8 para optimizar oxidación de grasas',
          ],
          priority: 'strength',
          dailyCalories: 2200,
          macroSplit: { protein: 40, carbs: 25, fat: 35 },
          supplements: ['L-Carnitina', 'CLA', 'Proteína isolada', 'Omega-3'],
          restrictions: [
            'Carbohidratos refinados',
            'Sodio excesivo',
            'Alcohol',
          ],
          goals: [NutritionGoal.LOSE_FAT, NutritionGoal.GAIN_MUSCLE],
        };

      case 'bulk':
        return {
          nutrition: [
            'Superávit calórico de 300-500 kcal con carbohidratos complejos',
            'Proteína de 1.6-2.0g/kg peso corporal con aminoácidos completos',
            'Carbohidratos 45-50% priorizando avena, arroz, batata',
            'Grasas 20-25% de fuentes naturales: aceite oliva, aguacate',
            'Comidas frecuentes cada 3-4 horas para síntesis proteica',
          ],
          priority: 'strength',
          dailyCalories: 3200,
          macroSplit: { protein: 25, carbs: 50, fat: 25 },
          supplements: [
            'Creatina monohidrato',
            'Proteína whey',
            'Maltodextrina',
          ],
          restrictions: ['Grasas trans', 'Alcohol', 'Azúcares simples'],
          goals: [NutritionGoal.GAIN_MUSCLE, NutritionGoal.INCREASE_ENERGY],
        };

      case 'lose_weight':
        return {
          nutrition: [
            'Déficit calórico de 500-750 kcal manteniendo masa muscular',
            'Proteína alta 30-35% para preservar músculo en déficit',
            'Carbohidratos de bajo IG 30-35% para estabilidad glucémica',
            'Fibra >30g/día para saciedad y regulación metabólica',
            'Hidratación 35-40ml/kg peso + 500ml adicionales por hora de ejercicio',
          ],
          priority: 'cardio',
          dailyCalories: 1800,
          macroSplit: { protein: 35, carbs: 30, fat: 35 },
          supplements: [
            'Fibra',
            'L-Carnitina',
            'Multivitamínico',
            'Termogénico natural',
          ],
          restrictions: [
            'Azúcares añadidos',
            'Procesados',
            'Bebidas calóricas',
          ],
          goals: [NutritionGoal.LOSE_FAT, NutritionGoal.IMPROVE_HEALTH],
        };

      default:
        return {
          nutrition: [
            'Balance calórico para mantenimiento según gasto energético',
            'Proteína 25-30% distribuida uniformemente en el día',
            'Carbohidratos complejos 40-45% según actividad física',
            'Grasas esenciales 25-30% priorizando omega-3 y monoinsaturadas',
            'Micronutrientes via alimentos integrales antes que suplementos',
          ],
          priority: 'general_fitness',
          dailyCalories: 2500,
          macroSplit: { protein: 25, carbs: 45, fat: 30 },
          supplements: ['Multivitamínico', 'Omega-3'],
          restrictions: ['Procesados excesivos', 'Azúcares refinados'],
          goals: [NutritionGoal.IMPROVE_HEALTH, NutritionGoal.MAINTAIN_WEIGHT],
        };
    }
  }

  private generateBodyAnalysisPrompt(
    userData: Omit<BodyAnalysisRequest, 'image'>,
  ): string {
    const {
      currentWeight,
      targetWeight,
      height,
      age,
      gender,
      activityLevel,
      goals,
    } = userData;

    const bmi =
      currentWeight && height
        ? currentWeight / Math.pow(height / 100, 2)
        : null;
    const goalDescription = this.getGoalDescription(goals?.[0] || '');
    const activityDescription = this.getActivityDescription(
      activityLevel || 'moderate',
    );

    return `Actúa como un entrenador personal certificado y especialista en composición corporal con experiencia clínica. Realiza un análisis técnico detallado de esta imagen corporal. IDIOMA: responde en español neutro y evita frases genéricas o motivacionales vacías.

DATOS DEL CLIENTE:
- Edad: ${age || 'No especificada'} años
- Género: ${gender || 'No especificado'}
- Altura: ${height || 'No especificada'} cm
- Peso actual: ${currentWeight || 'No especificado'} kg
- BMI actual: ${bmi ? bmi.toFixed(1) : 'No calculado'}
- Peso objetivo: ${targetWeight || 'No especificado'} kg
- Nivel de actividad: ${activityDescription}
- Objetivo principal: ${goalDescription}

REQUERIMIENTOS DE ANÁLISIS TÉCNICO:
1. Evaluación objetiva de composición corporal basada en marcadores visuales
2. Estimación de porcentaje de grasa corporal usando protocolos estándar
3. Análisis de desarrollo muscular por grupos específicos
4. Evaluación postural y asimetrías estructurales
5. Recomendaciones técnicas específicas por grupo muscular
6. Insights basados en evidencia científica, no motivacionales genéricos
7. TODO EN ESPAÑOL - sin mezclar idiomas

IMPORTANTE: Responde ÚNICAMENTE con un JSON válido, sin bloques de código markdown, sin explicaciones adicionales. Solo el JSON puro:
{
  "measurements": {
    "estimatedBodyFat": número_entre_10_y_30,
    "bodyFatPercentage": número_entre_10_y_30,
    "muscleDefinition": "low|moderate|high|very_high",
    "posture": "needs_attention|fair|good|excellent",
    "symmetry": "needs_attention|fair|good|excellent",
    "overallFitness": "beginner|intermediate|advanced|athlete"
  },
  "bodyComposition": {
    "estimatedBMI": número_estimado_general,
    "bodyType": "ectomorph|mesomorph|endomorph",
    "muscleMass": "low|medium|high",
    "bodyFat": "low|medium|high",
    "metabolism": "slow|medium|fast",
    "boneDensity": "light|medium|heavy",
    "muscleGroups": [
      {
        "name": "nombre_general_grupo",
        "development": "underdeveloped|developing|well_developed|good|excellent|highly_developed",
        "recommendations": ["consejo_general1", "consejo_general2"]
      }
    ]
  },
  "progress": {
    "strengths": ["fortaleza_técnica_específica1", "ventaja_compositiva2"],
    "areasToImprove": ["déficit_muscular_específico1", "asimetría_postural2"],
    "generalAdvice": "protocolo_técnico_específico_objetivo"
  },
  "confidence": número_entre_0.3_y_0.8,
  "disclaimer": "Análisis basado en evaluación visual. Para mediciones precisas, utiliza métodos como DEXA o bioimpedancia.",
  "insights": ["observación_técnica_específica1", "recomendación_basada_evidencia2", "protocolo_seguimiento3"]
}`;
  }

  private getGoalDescription(goal: string): string {
    const goals: { [key: string]: string } = {
      lose_weight: 'Pérdida de peso y reducción de grasa corporal',
      gain_muscle: 'Ganancia de masa muscular',
      define: 'Definición y tonificación muscular',
      maintain: 'Mantenimiento de composición corporal actual',
      bulk: 'Aumento de volumen muscular',
      recomp: 'Recomposición corporal (ganar músculo, perder grasa)',
    };
    return goals[goal] || 'Mejora general de la condición física';
  }

  private getActivityDescription(activityLevel: string): string {
    const activities: { [key: string]: string } = {
      sedentary: 'Sedentario (poco o ningún ejercicio)',
      light: 'Actividad ligera (1-3 días/semana)',
      moderate: 'Actividad moderada (3-5 días/semana)',
      active: 'Muy activo (6-7 días/semana)',
      very_active: 'Extremadamente activo (ejercicio intenso diario)',
    };
    return activities[activityLevel] || 'Actividad moderada';
  }

  private validateAndCleanBodyAnalysis(
    analysis: any,
    userData: Omit<BodyAnalysisRequest, 'image'>,
  ): BodyAnalysisApiResponse {
    // SOLO validar tipos y rangos, NO sobreescribir con hardcoded values
    const validatedAnalysis = {
      bodyType: this.validateEnum(
        analysis.bodyComposition?.bodyType || analysis.bodyType,
        Object.values(BodyType),
        BodyType.MESOMORPH,
      ),
      measurements: {
        estimatedBodyFat: this.clampNumber(
          analysis.measurements?.estimatedBodyFat,
          5,
          40,
          15,
        ),
        bodyFatPercentage: this.clampNumber(
          analysis.measurements?.bodyFatPercentage ||
            analysis.measurements?.estimatedBodyFat,
          5,
          40,
          15,
        ),
        muscleDefinition: this.validateEnum(
          analysis.measurements?.muscleDefinition,
          ['low', 'moderate', 'high', 'very_high'] as const,
          'moderate' as const,
        ) as 'low' | 'moderate' | 'high' | 'very_high',
        posture: this.validateEnum(
          analysis.measurements?.posture,
          ['needs_attention', 'fair', 'good', 'excellent'] as const,
          'fair' as const,
        ) as 'needs_attention' | 'fair' | 'good' | 'excellent',
        symmetry: this.validateEnum(
          analysis.measurements?.symmetry,
          ['needs_attention', 'fair', 'good', 'excellent'] as const,
          'fair' as const,
        ) as 'needs_attention' | 'fair' | 'good' | 'excellent',
        overallFitness: this.validateEnum(
          analysis.measurements?.overallFitness,
          ['beginner', 'intermediate', 'advanced', 'athlete'] as const,
          'intermediate' as const,
        ) as 'beginner' | 'intermediate' | 'advanced' | 'athlete',
        // Datos del usuario (no de la IA)
        age: userData.age,
        gender: userData.gender,
        activityLevel: userData.activityLevel as ActivityLevel,
        goals: userData.goals,
        height: userData.height,
        weight: userData.currentWeight,
        // Medidas estimadas por IA (si las tiene)
        waist: analysis.measurements?.waist
          ? this.clampNumber(analysis.measurements.waist, 60, 150, 80)
          : undefined,
        chest: analysis.measurements?.chest
          ? this.clampNumber(analysis.measurements.chest, 70, 180, 90)
          : undefined,
        hips: analysis.measurements?.hips
          ? this.clampNumber(analysis.measurements.hips, 70, 150, 85)
          : undefined,
      },
      bodyComposition: {
        estimatedBMI: analysis.bodyComposition?.estimatedBMI
          ? this.clampNumber(analysis.bodyComposition.estimatedBMI, 15, 50, 25)
          : userData.currentWeight && userData.height
            ? userData.currentWeight / Math.pow(userData.height / 100, 2)
            : undefined,
        muscleMass: this.validateEnum(
          analysis.bodyComposition?.muscleMass,
          ['low', 'medium', 'high'] as const,
          'medium' as const,
        ) as 'low' | 'medium' | 'high',
        bodyFat: this.validateEnum(
          analysis.bodyComposition?.bodyFat,
          ['low', 'medium', 'high'] as const,
          'medium' as const,
        ) as 'low' | 'medium' | 'high',
        metabolism: this.validateEnum(
          analysis.bodyComposition?.metabolism,
          ['slow', 'medium', 'fast'] as const,
          'medium' as const,
        ) as 'slow' | 'medium' | 'fast',
        boneDensity: this.validateEnum(
          analysis.bodyComposition?.boneDensity,
          ['light', 'medium', 'heavy'] as const,
          'medium' as const,
        ) as 'light' | 'medium' | 'heavy',
        bodyType: this.validateEnum(
          analysis.bodyComposition?.bodyType || analysis.bodyType,
          Object.values(BodyType),
          BodyType.MESOMORPH,
        ),
        muscleGroups: Array.isArray(analysis.bodyComposition?.muscleGroups)
          ? analysis.bodyComposition.muscleGroups
              .slice(0, 8) // Permitir más grupos musculares
              .map((group: any) => ({
                name: group.name || 'Grupo muscular',
                development: this.validateEnum(
                  group.development,
                  [
                    'underdeveloped',
                    'developing',
                    'well_developed',
                    'good',
                    'excellent',
                    'highly_developed',
                  ],
                  'developing',
                ),
                recommendations: Array.isArray(group.recommendations)
                  ? group.recommendations.slice(0, 4) // Más recomendaciones
                  : ['Continuar entrenamiento específico'],
              }))
          : [],
      },
      // ESTA SECCIÓN SE LLENARÁ CON generateNutritionRecommendation() - NO hardcodear
      recommendations: {} as NutritionRecommendations, // Se asigna después
      progress: {
        strengths: Array.isArray(analysis.progress?.strengths)
          ? analysis.progress.strengths.slice(0, 6) // Más fortalezas
          : [],
        areasToImprove: Array.isArray(analysis.progress?.areasToImprove)
          ? analysis.progress.areasToImprove.slice(0, 6) // Más áreas de mejora
          : [],
        generalAdvice: analysis.progress?.generalAdvice || '',
      },
      confidence: this.clampNumber(analysis.confidence, 0.1, 1.0, 0.7),
      disclaimer:
        analysis.disclaimer ||
        'Análisis basado en evaluación visual. Para mediciones precisas, utiliza métodos como DEXA o bioimpedancia.',
      insights: Array.isArray(analysis.insights)
        ? analysis.insights.slice(0, 6) // Más insights
        : [],
    };

    return validatedAnalysis;
  }

  private clampNumber(
    value: any,
    min: number,
    max: number,
    defaultValue: number,
  ): number {
    const num = parseFloat(value);
    if (isNaN(num)) return defaultValue;
    return Math.max(min, Math.min(max, num));
  }

  // 1. NUEVO helper (colócalo junto a clampNumber / validateEnum)
  private isJson(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }

  private validateEnum<T>(value: any, validValues: T[], defaultValue: T): T {
    return validValues.includes(value) ? value : defaultValue;
  }

  private getDefaultMuscleGroups() {
    return [
      {
        name: 'Core',
        development: 'developing',
        recommendations: ['Ejercicios de plancha', 'Abdominales funcionales'],
      },
      {
        name: 'Extremidades superiores',
        development: 'good',
        recommendations: ['Flexiones', 'Ejercicios con peso corporal'],
      },
      {
        name: 'Extremidades inferiores',
        development: 'excellent',
        recommendations: ['Sentadillas', 'Ejercicios de fuerza'],
      },
    ];
  }
}
