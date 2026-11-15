import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { resolveImageUrl } from '../../common/utils/image.utils';
import { AICostService } from '../ai-cost/ai-cost.service';
import {
  AnalyzedFood,
  buildFoodAnalysis,
  FOOD_ANALYSIS_SCHEMA,
  FOOD_MODEL,
  FOOD_SYSTEM_PROMPT,
  FoodAnalysisError,
  FoodAnalysisResult,
  MacroTotals,
  MEAL_LABELS_ES,
  RawFoodAnalysis,
} from './food-analysis';

export type FoodAnalysisResponse = FoodAnalysisResult;
export type DetectedFood = AnalyzedFood;
export type Macronutrients = MacroTotals;

export enum MealType {
  BREAKFAST = 'breakfast',
  LUNCH = 'lunch',
  MERIENDA = 'merienda',
  DINNER = 'dinner',
  SNACK = 'snack',
  OTHER = 'other',
}

type UserContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string; detail: 'high' } }
    >;

@Injectable()
export class AnalyzeFoodService {
  private readonly logger = new Logger(AnalyzeFoodService.name);

  private openai: OpenAI | null = null;

  constructor(private aiCostService: AICostService) {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  /** Analiza una foto (plato, receta o etiqueta nutricional). */
  async analyzeImageFood(
    imageBase64: string,
    mealType?: string,
    context?: string,
    userId?: string,
  ): Promise<FoodAnalysisResponse> {
    const text = [
      `Analizá la comida de la foto${this.mealHint(mealType)}.`,
      context?.trim()
        ? `Aclaraciones del usuario (mandan sobre lo que se ve):\n${context.trim()}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    return this.run(
      [
        { type: 'text', text },
        {
          type: 'image_url',
          image_url: { url: resolveImageUrl(imageBase64), detail: 'high' },
        },
      ],
      'analyze-food-image',
      mealType,
      1,
      userId,
    );
  }

  /**
   * Analiza una comida descrita en texto libre. `servings` = cuantas porciones
   * de lo descrito se comieron; se aplica en codigo sobre los gramos.
   */
  async analyzeManualFood(
    ingredients: string,
    servings: number = 1,
    mealType: MealType,
    context?: string,
    userId?: string,
  ): Promise<FoodAnalysisResponse> {
    const text = [
      `Analizá esta comida${this.mealHint(mealType)}:\n${ingredients.trim()}`,
      context?.trim() ? `Aclaraciones del usuario:\n${context.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    return this.run(text, 'analyze-food-manual', mealType, servings, userId);
  }

  private mealHint(mealType?: string): string {
    const label = mealType ? MEAL_LABELS_ES[mealType] : undefined;
    return label && mealType !== 'other' ? ` (${label})` : '';
  }

  private async run(
    userContent: UserContent,
    costService: string,
    mealType: string | undefined,
    servings: number,
    userId?: string,
  ): Promise<FoodAnalysisResponse> {
    if (!this.openai) {
      throw new ServiceUnavailableException(
        'El análisis con IA no está disponible (falta configurar OpenAI)',
      );
    }

    try {
      const completion = await this.openai.chat.completions.create({
        model: FOOD_MODEL,
        messages: [
          { role: 'system', content: FOOD_SYSTEM_PROMPT },
          { role: 'user', content: userContent as any },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: FOOD_ANALYSIS_SCHEMA as any,
        },
        // Incluye los tokens de razonamiento del modelo.
        max_completion_tokens: 6000,
        reasoning_effort: 'low',
      });

      if (userId) {
        await this.aiCostService.logFromCompletion(
          userId,
          costService,
          completion as any,
          FOOD_MODEL,
        );
      }

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Respuesta vacía del modelo');
      }
      const raw = JSON.parse(content) as RawFoodAnalysis;

      const usage = completion.usage;
      const aiCostUsd = usage
        ? this.aiCostService.calculateCost(
            usage.prompt_tokens,
            usage.completion_tokens,
            FOOD_MODEL,
          )
        : null;

      try {
        return {
          ...buildFoodAnalysis(raw, mealType || MealType.OTHER, servings),
          aiCostUsd,
        };
      } catch (error) {
        if (error instanceof FoodAnalysisError) {
          const why = Array.isArray(raw?.assumptions)
            ? raw.assumptions.filter(Boolean).join(' ')
            : '';
          throw new UnprocessableEntityException(
            `No pude identificar comida${why ? `: ${why}` : '. Probá con otra foto o describila.'}`,
          );
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Nunca se devuelve un analisis de ejemplo: un plato inventado en el
      // diario es peor que un error que el usuario puede reintentar.
      this.logger.error(`Error analizando comida (${costService})`, error as any);
      throw new ServiceUnavailableException(
        'No se pudo analizar la comida. Probá de nuevo en un momento.',
      );
    }
  }
}
