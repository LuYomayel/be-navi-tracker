import {
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AnalyzeFoodService } from './analyze-food.service';
import { ApiResponse } from '../../common/types';

export enum MealType {
  BREAKFAST = 'breakfast',
  LUNCH = 'lunch',
  DINNER = 'dinner',
  SNACK = 'snack',
  OTHER = 'other',
}

interface FoodAnalysisImageRequest {
  image: string;
  mealType?: MealType;
}

interface FoodAnalysisManualRequest {
  mealType: MealType;
  name: string;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
}

@Controller('analyze-food')
export class AnalyzeFoodController {
  constructor(private readonly analyzeFoodService: AnalyzeFoodService) {}

  @Post('image')
  async analyzeFood(
    @Body() request: FoodAnalysisImageRequest,
  ): Promise<ApiResponse<any>> {
    try {
      const { image, mealType } = request;

      if (!image) {
        throw new HttpException('Imagen requerida', HttpStatus.BAD_REQUEST);
      }

      const analysis = await this.analyzeFoodService.analyzeImageFood(
        image,
        mealType,
      );

      return {
        success: true,
        data: analysis,
      };
    } catch (error) {
      console.error('Error analyzing food:', error);
      throw new HttpException(
        'Error analizando la comida',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('manual')
  async analyzeFoodManual(
    @Body() request: FoodAnalysisManualRequest,
  ): Promise<ApiResponse<any>> {
    try {
      const {
        name,
        servings,
        calories,
        protein,
        carbs,
        fat,
        fiber,
        sugar,
        sodium,
        mealType,
      } = request;

      if (!name) {
        throw new HttpException('Imagen requerida', HttpStatus.BAD_REQUEST);
      }

      const analysis = await this.analyzeFoodService.analyzeManualFood(
        name,
        servings,
        calories,
        protein,
        carbs,
        fat,
        fiber,
        sugar,
        sodium,
        mealType,
      );

      return {
        success: true,
        data: analysis,
      };
    } catch (error) {
      console.error('Error analyzing food:', error);
      throw new HttpException(
        'Error analizando la comida',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  async getStatus(): Promise<
    ApiResponse<{ status: string; openaiAvailable: boolean }>
  > {
    return {
      success: true,
      data: {
        status: 'Servicio de análisis de comida disponible',
        openaiAvailable: !!process.env.OPENAI_API_KEY,
      },
    };
  }
}
