import {
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { BodyAnalysisService } from './body-analysis.service';
import { ApiResponse } from '../../common/types';

interface BodyAnalysisRequest {
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

@Controller('body-analysis')
export class BodyAnalysisController {
  constructor(private readonly bodyAnalysisService: BodyAnalysisService) {}

  @Post()
  async analyzeBody(
    @Body() request: BodyAnalysisRequest,
  ): Promise<ApiResponse<any>> {
    try {
      const { image, ...userData } = request;

      if (!image) {
        throw new HttpException('Imagen requerida', HttpStatus.BAD_REQUEST);
      }

      const analysis = await this.bodyAnalysisService.analyzeBodyImage(
        image,
        userData,
      );

      // Guardar el análisis en la base de datos
      const savedAnalysis = await this.bodyAnalysisService.create({
        bodyType: analysis.bodyComposition.bodyType,
        measurements: analysis.measurements as any,
        bodyComposition: analysis.bodyComposition as any,
        recommendations: analysis.recommendations as any,
        aiConfidence: analysis.confidence,
        userId: 'default',
      });

      return {
        success: true,
        data: {
          ...analysis,
          id: savedAnalysis.id,
        },
      };
    } catch (error) {
      console.error('Error analyzing body:', error);
      throw new HttpException(
        'Error analizando la imagen corporal',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  async getAnalyses(): Promise<ApiResponse<any[]>> {
    try {
      const analyses = await this.bodyAnalysisService.getAll();
      return {
        success: true,
        data: analyses,
      };
    } catch (error) {
      console.error('Error fetching body analyses:', error);
      return {
        success: false,
        error: 'Error fetching body analyses',
      };
    }
  }
}
