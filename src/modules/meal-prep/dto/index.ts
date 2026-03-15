import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsBoolean,
  IsObject,
} from 'class-validator';

// ─── Types compartidos ────────────────────────────────────────

export type DayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type MealSlotKey = 'breakfast' | 'lunch' | 'snack' | 'dinner';

export interface MealPrepSlot {
  name: string;
  foods: any[]; // DetectedFood[]
  totalCalories: number;
  macronutrients: {
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    sugar?: number;
    sodium?: number;
  };
  notes?: string;
  savedMealId?: string;
  eatenAt?: string;
  nutritionAnalysisId?: string;
  isFixed?: boolean;
}

export interface MealPrepDay {
  slots: Record<MealSlotKey, MealPrepSlot | null>;
}

export interface MealPrepWeek {
  days: Record<DayKey, MealPrepDay>;
}

export interface MacroSummary {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

// ─── Nutritionist Plan DTOs ───────────────────────────────────

export class ImportNutritionistPlanDto {
  @IsArray()
  @IsNotEmpty()
  images: string[]; // base64 por página

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  pdfFilename?: string;
}

export class UpdateNutritionistPlanDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

// ─── Meal Prep DTOs ───────────────────────────────────────────

export class GenerateMealPrepDto {
  @IsString()
  @IsOptional()
  nutritionistPlanId?: string;

  @IsString()
  @IsOptional()
  userContext?: string;

  @IsString()
  @IsNotEmpty()
  weekStartDate: string; // YYYY-MM-DD del lunes

  @IsArray()
  @IsOptional()
  fixedSlots?: Array<{
    day: DayKey;
    mealType: MealSlotKey;
    savedMealId?: string;
    customSlot?: Partial<MealPrepSlot>;
  }>;

  @IsArray()
  @IsOptional()
  savedMealPreferences?: string[]; // IDs de SavedMeals
}

export class CreateMealPrepDto {
  @IsString()
  @IsNotEmpty()
  weekStartDate: string;

  @IsString()
  @IsOptional()
  nutritionistPlanId?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsObject()
  @IsNotEmpty()
  days: MealPrepWeek;
}

export class UpdateMealPrepDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsObject()
  @IsOptional()
  days?: MealPrepWeek;

  @IsString()
  @IsOptional()
  status?: 'active' | 'archived';
}

export class UpdateSlotDto {
  @IsString()
  @IsNotEmpty()
  day: DayKey;

  @IsString()
  @IsNotEmpty()
  mealType: MealSlotKey;

  @IsObject()
  @IsNotEmpty()
  slot: Partial<MealPrepSlot>;
}

export class MarkSlotEatenDto {
  @IsString()
  @IsNotEmpty()
  day: DayKey;

  @IsString()
  @IsNotEmpty()
  mealType: MealSlotKey;

  @IsString()
  @IsNotEmpty()
  date: string; // YYYY-MM-DD
}
