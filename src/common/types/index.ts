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
  recommendations?: NutritionRecommendations;
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
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
