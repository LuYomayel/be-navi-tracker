import {
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AnalyzeFoodService } from './analyze-food.service';
import { ApiResponse } from '../../common/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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
  ingredients: string; // Descripción libre de ingredientes
  servings?: number; // Número de porciones (opcional, default 1)
  mealType: MealType;
}

@Controller('analyze-food')
@UseGuards(JwtAuthGuard)
export class AnalyzeFoodController {
  constructor(private readonly analyzeFoodService: AnalyzeFoodService) {}

  @Post('image')
  async analyzeFood(
    @Body() request: FoodAnalysisImageRequest,
    @Req() req: any,
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
      const { ingredients, servings = 1, mealType } = request;

      if (!ingredients || ingredients.trim() === '') {
        throw new HttpException(
          'Descripción de ingredientes requerida',
          HttpStatus.BAD_REQUEST,
        );
      }

      const analysis = await this.analyzeFoodService.analyzeManualFood(
        ingredients,
        servings,
        mealType,
      );

      return {
        success: true,
        data: analysis,
      };
    } catch (error) {
      console.error('Error analyzing manual food:', error);
      throw new HttpException(
        'Error analizando la comida manual',
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
