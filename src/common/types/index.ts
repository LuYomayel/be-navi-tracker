import { User } from '@prisma/client';

export interface PhysicalActivity {
  id: string;
  userId: string;
  date: string; // yyyy-MM-dd (UTC 00:00)
  steps: number;
  distanceKm: number;
  activeEnergyKcal: number;
  exerciseMinutes: number;
  standHours: number;
  screenshotUrl: string;
  source: string;
  aiConfidence: number;
  createdAt: Date;
  updatedAt: Date;

  user?: User;
}
export interface Activity {
  id: string;
  name: string;
  description?: string;
  time?: string;
  days: boolean[]; // Array de 7 booleans [L, M, X, J, V, S, D]
  color: string;
  category?: string;
  createdAt: Date;
  updatedAt: Date;
  userId?: string;
  user?: User;
  archived?: boolean;
}

export interface DailyCompletion {
  id: string;
  activityId: string;
  date: string; // YYYY-MM-DD format
  completed: boolean;
  notes?: string;
  createdAt: Date;
}

export interface NutritionAnalysis {
  id: string;
  userId: string;
  date: string;
  mealType: string;
  foods: DetectedFood[];
  totalCalories: number;
  macronutrients: Macronutrients;
  imageUrl?: string;
  aiConfidence: number;
  userAdjustments?: UserNutritionAdjustments;
  createdAt: Date;
  updatedAt: Date;
}

export interface DetectedFood {
  name: string;
  quantity: number;
  unit: string;
  calories: number;
  confidence: number;
}

export interface Macronutrients {
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface UserNutritionAdjustments {
  foods: DetectedFood[];
  totalCalories: number;
  macronutrients: Macronutrients;
}

export interface BodyAnalysis {
  id: string;
  userId: string;
  bodyType: string;
  measurements?: BodyMeasurements;
  bodyComposition?: BodyComposition;
  recommendations?: NutritionRecommendations | string[];
  progress?: {
    strengths: string[];
    areasToImprove: string[];
    generalAdvice: string;
  };
  insights?: string[];
  disclaimer?: string;
  rawAnalysis?: any;
  imageUrl?: string;
  aiConfidence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BodyMeasurements {
  height: number;
  weight: number;
  age: number;
  gender: string;
}

export interface BodyComposition {
  bodyFatPercentage: number;
  muscleMass: number;
  bmr: number;
}

export interface NutritionRecommendations {
  dailyCalories: number;
  macronutrients: Macronutrients;
  mealPlan?: string[];
}

export interface AISuggestion {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: string;
  basedOn: string[];
  actions?: any[];
  dismissedAt?: Date;
  createdAt: Date;
}

export interface ChatMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface DailyNote {
  id: string;
  date: string; // YYYY-MM-DD
  content: string;
  mood?: number; // 1-5
  predefinedComments?: string[]; // IDs de comentarios predefinidos seleccionados
  customComment?: string; // Comentario personalizado del usuario
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  id: string;
  userId: string;

  // Datos personales
  height: number;
  currentWeight: number;
  targetWeight: number;
  age: number;
  gender: string;
  activityLevel: string;

  // Objetivos de fitness
  fitnessGoals: string[];

  // Objetivos nutricionales (calculados/ajustados)
  dailyCalorieGoal: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
  fiberGoal: number;

  // Metadatos
  lastBodyAnalysisId: string;
  bmr: number;
  tdee: number;

  // Configuraciones adicionales
  preferredUnits: string;
  notifications: any;

  createdAt: Date;
  updatedAt: Date;
}

export interface WeightEntry {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
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
  createdAt: Date;
  updatedAt: Date;
}

export interface WeightEntryAnalysis {
  weight: number;
  bodyFatPercentage: number;
  muscleMassPercentage: number;
  bodyWaterPercentage: number;
  bmi: number;
  bfr: number;
  score: number;
  source: 'manual' | 'photo' | 'scale';
  aiConfidence: number;
  notes: string;
}

export interface WeightAnalysis {
  currentWeight: number;
  previousWeight?: number;
  weightChange?: number; // kg
  weightChangePercentage?: number; // %
  bmiChange?: number;
  bfrChange?: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  period: 'day' | 'week' | 'month';
  classification: 'underweight' | 'normal' | 'overweight' | 'obese';
  targetWeight?: number;
  progressToTarget?: number; // %
}

export interface WeightStats {
  totalEntries: number;
  averageWeight: number;
  minWeight: number;
  maxWeight: number;
  weightRange: number;
  averageBMI?: number;
  averageBFR?: number;
  timeframe: 'week' | 'month' | 'year';
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
