import OpenAI from 'openai';

// Interfaces copiadas del servicio
export interface BodyAnalysisRequest {
  image: string;
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
  ECTOMORPH = 'ectomorph',
  MESOMORPH = 'mesomorph',
  ENDOMORPH = 'endomorph',
}

export enum ActivityLevel {
  SEDENTARY = 'sedentary',
  LIGHT = 'light',
  MODERATE = 'moderate',
  ACTIVE = 'active',
  VERY_ACTIVE = 'very_active',
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
    protein: number;
    carbs: number;
    fat: number;
  };
  supplements?: string[];
  restrictions?: string[];
  goals: string[];
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

// Helper functions
export function isJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

export function cleanJson(response: string): string {
  let cleaned = response.trim();

  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  return cleaned.trim();
}

export function clampNumber(
  value: any,
  min: number,
  max: number,
  defaultValue: number,
): number {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return defaultValue;
  return Math.min(Math.max(num, min), max);
}

export function validateEnum<T>(
  value: any,
  validValues: T[],
  defaultValue: T,
): T {
  return validValues.includes(value) ? value : defaultValue;
}

export function getDefaultMuscleGroups() {
  return [
    {
      name: 'torso',
      development: 'developing' as const,
      recommendations: [
        'Incorporar ejercicios compuestos como flexiones y fondos',
        'Trabajar el core con planks y ejercicios de estabilidad',
      ],
    },
    {
      name: 'arms',
      development: 'good' as const,
      recommendations: [
        'Mantener rutina actual de entrenamiento de brazos',
        'Incluir ejercicios de tracción para equilibrio muscular',
      ],
    },
    {
      name: 'legs',
      development: 'good' as const,
      recommendations: [
        'Continuar con ejercicios de piernas como sentadillas',
        'Agregar trabajo de movilidad y flexibilidad',
      ],
    },
  ];
}

export function generateBodyAnalysisPrompt(
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

  return `Actúa como un experto nutricionista deportivo con 15 años de experiencia en análisis corporal.

INFORMACIÓN DEL USUARIO:
- Peso actual: ${currentWeight || 'No especificado'}kg
- Peso objetivo: ${targetWeight || 'No especificado'}kg  
- Altura: ${height || 'No especificado'}cm
- Edad: ${age || 'No especificado'} años
- Género: ${gender || 'No especificado'}
- Nivel de actividad: ${activityLevel || 'No especificado'}
- Objetivos: ${goals?.join(', ') || 'No especificados'}

INSTRUCCIONES:
1. Analiza la imagen corporal con criterio profesional
2. Determina el tipo de cuerpo (ectomorph, mesomorph, endomorph)
3. Evalúa la composición corporal y desarrollo muscular
4. Proporciona mediciones estimadas realistas
5. Genera recomendaciones específicas y profesionales

IMPORTANTE: Responde ÚNICAMENTE con un JSON válido, sin markdown ni explicaciones adicionales:

{
  "bodyType": "ectomorph|mesomorph|endomorph",
  "measurements": {
    "bodyFatPercentage": numero_estimado,
    "muscleDefinition": "low|moderate|high|very_high",
    "posture": "needs_attention|fair|good|excellent", 
    "symmetry": "needs_attention|fair|good|excellent",
    "overallFitness": "beginner|intermediate|advanced|athlete",
    "height": ${height || 170},
    "weight": ${currentWeight || 70},
    "age": ${age || 25},
    "gender": "${gender || 'male'}",
    "activityLevel": "${activityLevel || 'moderate'}"
  },
  "bodyComposition": {
    "estimatedBMI": numero_calculado,
    "bodyType": "mismo_que_arriba",
    "muscleMass": "low|medium|high",
    "bodyFat": "low|medium|high", 
    "metabolism": "slow|medium|fast",
    "boneDensity": "light|medium|heavy",
    "muscleGroups": [
      {
        "name": "torso",
        "development": "developing|good|excellent",
        "recommendations": ["consejo_específico_1", "consejo_específico_2"]
      },
      {
        "name": "arms", 
        "development": "developing|good|excellent",
        "recommendations": ["consejo_específico_1", "consejo_específico_2"]
      },
      {
        "name": "legs",
        "development": "developing|good|excellent", 
        "recommendations": ["consejo_específico_1", "consejo_específico_2"]
      }
    ]
  },
  "progress": {
    "strengths": ["fortaleza_1", "fortaleza_2"],
    "areasToImprove": ["área_mejora_1", "área_mejora_2"],
    "generalAdvice": "consejo_general_específico"
  },
  "confidence": 0.85,
  "disclaimer": "Análisis basado en evaluación visual. Para mediciones precisas, consulta un profesional.",
  "insights": ["insight_profesional_1", "insight_profesional_2"]
}`;
}

export async function generateNutritionRecommendation(
  validatedAnalysis: BodyAnalysisApiResponse,
  openaiApiKey?: string,
): Promise<NutritionRecommendations> {
  if (!openaiApiKey) {
    return getSmartNutritionFallback('lose_weight');
  }

  const openai = new OpenAI({ apiKey: openaiApiKey });

  try {
    const prompt = generateNutritionRecommendationPrompt(validatedAnalysis);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.3,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No se recibió respuesta de OpenAI');
    }

    const cleanedResponse = cleanJson(response);
    const parsed = JSON.parse(cleanedResponse);

    return {
      nutrition: parsed.nutrition || [],
      priority: parsed.priority || 'general_fitness',
      dailyCalories: parsed.dailyCalories || 2000,
      macroSplit: parsed.macroSplit || { protein: 30, carbs: 40, fat: 30 },
      supplements: parsed.supplements || [],
      goals: parsed.goals || ['improve_health'],
    };
  } catch (error) {
    console.error('Error generando recomendaciones nutricionales:', error);
    return getSmartNutritionFallback('lose_weight');
  }
}

function generateNutritionRecommendationPrompt(
  validatedAnalysis: BodyAnalysisApiResponse,
): string {
  const { bodyType, measurements, bodyComposition } = validatedAnalysis;

  return `Como nutricionista deportivo experto, genera recomendaciones nutricionales específicas para:

ANÁLISIS CORPORAL:
- Tipo de cuerpo: ${bodyType}
- % Grasa corporal: ${measurements.bodyFatPercentage}%
- Masa muscular: ${bodyComposition.muscleMass}
- Metabolismo: ${bodyComposition.metabolism}
- Nivel fitness: ${measurements.overallFitness}

Responde ÚNICAMENTE con JSON válido:

{
  "nutrition": [
    "recomendación_nutricional_específica_1",
    "recomendación_nutricional_específica_2", 
    "recomendación_nutricional_específica_3"
  ],
  "priority": "strength|cardio|general_fitness",
  "dailyCalories": numero_específico_basado_en_análisis,
  "macroSplit": {
    "protein": porcentaje_específico,
    "carbs": porcentaje_específico,
    "fat": porcentaje_específico
  },
  "supplements": ["suplemento_específico_1", "suplemento_específico_2"],
  "goals": ["goal_específico_1", "goal_específico_2"]
}`;
}

function getSmartNutritionFallback(objetivo: string): NutritionRecommendations {
  const recommendations = {
    lose_weight: {
      nutrition: [
        'Déficit calórico de 300-500 kcal mediante ciclado de carbohidratos',
        'Aumentar proteína a 1.8-2.2g/kg para preservar masa muscular durante el cut',
        'Timing de carbohidratos pre/post entrenamiento para optimizar rendimiento',
      ],
      dailyCalories: 1800,
      macroSplit: { protein: 35, carbs: 30, fat: 35 },
      supplements: ['L-Carnitina', 'CLA', 'Termogénico natural'],
    },
    gain_muscle: {
      nutrition: [
        'Superávit calórico controlado de 200-400 kcal para lean bulk',
        'Proteína de alto valor biológico distribuida en 4-5 comidas',
        'Carbohidratos complejos post-entrenamiento para síntesis proteica',
      ],
      dailyCalories: 3200,
      macroSplit: { protein: 25, carbs: 50, fat: 25 },
      supplements: [
        'Creatina monohidrato',
        'Proteína isolada',
        'Maltodextrina',
      ],
    },
  };

  const selected = recommendations[objetivo] || recommendations.lose_weight;

  return {
    nutrition: selected.nutrition,
    priority: 'strength',
    dailyCalories: selected.dailyCalories,
    macroSplit: selected.macroSplit,
    supplements: selected.supplements,
    goals: [objetivo],
  };
}

export function validateAndCleanBodyAnalysis(
  analysis: any,
  userData: Omit<BodyAnalysisRequest, 'image'>,
): BodyAnalysisApiResponse {
  if (!analysis) {
    return getFallbackAnalysis();
  }

  // Validar y limpiar measurements
  const measurements: BodyMeasurements = {
    bodyFatPercentage: clampNumber(
      analysis.measurements?.bodyFatPercentage,
      5,
      50,
      20,
    ),
    muscleDefinition: validateEnum(
      analysis.measurements?.muscleDefinition,
      ['low', 'moderate', 'high', 'very_high'],
      'moderate',
    ),
    posture: validateEnum(
      analysis.measurements?.posture,
      ['needs_attention', 'fair', 'good', 'excellent'],
      'fair',
    ),
    symmetry: validateEnum(
      analysis.measurements?.symmetry,
      ['needs_attention', 'fair', 'good', 'excellent'],
      'fair',
    ),
    overallFitness: validateEnum(
      analysis.measurements?.overallFitness,
      ['beginner', 'intermediate', 'advanced', 'athlete'],
      'intermediate',
    ),
    height: userData.height || 170,
    weight: userData.currentWeight || 70,
    age: userData.age || 25,
    gender: userData.gender || 'male',
    activityLevel: validateEnum(
      userData.activityLevel,
      Object.values(ActivityLevel),
      ActivityLevel.MODERATE,
    ),
  };

  // Validar bodyComposition
  const bodyComposition: BodyComposition = {
    estimatedBMI: clampNumber(
      analysis.bodyComposition?.estimatedBMI,
      15,
      40,
      measurements.weight / (measurements.height / 100) ** 2,
    ),
    bodyType: validateEnum(
      analysis.bodyComposition?.bodyType || analysis.bodyType,
      Object.values(BodyType),
      BodyType.MESOMORPH,
    ),
    muscleMass: validateEnum(
      analysis.bodyComposition?.muscleMass,
      ['low', 'medium', 'high'],
      'medium',
    ),
    bodyFat: validateEnum(
      analysis.bodyComposition?.bodyFat,
      ['low', 'medium', 'high'],
      'medium',
    ),
    metabolism: validateEnum(
      analysis.bodyComposition?.metabolism,
      ['slow', 'medium', 'fast'],
      'medium',
    ),
    boneDensity: validateEnum(
      analysis.bodyComposition?.boneDensity,
      ['light', 'medium', 'heavy'],
      'medium',
    ),
    muscleGroups:
      analysis.bodyComposition?.muscleGroups || getDefaultMuscleGroups(),
  };

  return {
    bodyType: bodyComposition.bodyType,
    bodyComposition,
    measurements,
    recommendations: {} as NutritionRecommendations, // Se llenará después
    progress: {
      strengths: analysis.progress?.strengths || [
        'Compromiso con el ejercicio',
      ],
      areasToImprove: analysis.progress?.areasToImprove || [
        'Consistencia en la rutina',
      ],
      generalAdvice:
        analysis.progress?.generalAdvice ||
        'Mantén la constancia y ajusta según progresos',
    },
    confidence: clampNumber(analysis.confidence, 0.1, 1.0, 0.7),
    disclaimer:
      analysis.disclaimer ||
      'Análisis basado en evaluación visual. Para mediciones precisas, consulta un profesional.',
    insights: analysis.insights || [
      'Continúa con tu rutina actual',
      'Considera ajustar la nutrición según objetivos',
    ],
  };
}

function getFallbackAnalysis(): BodyAnalysisApiResponse {
  return {
    bodyType: BodyType.MESOMORPH,
    measurements: {
      bodyFatPercentage: 18,
      muscleDefinition: 'moderate',
      posture: 'fair',
      symmetry: 'good',
      overallFitness: 'intermediate',
      height: 170,
      weight: 70,
      age: 25,
      gender: 'male',
      activityLevel: ActivityLevel.MODERATE,
    },
    bodyComposition: {
      estimatedBMI: 24.2,
      bodyType: BodyType.MESOMORPH,
      muscleMass: 'medium',
      bodyFat: 'medium',
      metabolism: 'medium',
      boneDensity: 'medium',
      muscleGroups: getDefaultMuscleGroups(),
    },
    recommendations: {} as NutritionRecommendations,
    progress: {
      strengths: ['Estructura corporal equilibrada'],
      areasToImprove: ['Definición muscular'],
      generalAdvice:
        'Mantén una rutina constante de ejercicio y nutrición balanceada',
    },
    confidence: 0.7,
    disclaimer: 'Análisis basado en parámetros estándar.',
    insights: [
      'Buen potencial para desarrollo muscular',
      'Respuesta favorable al entrenamiento',
    ],
  };
}
