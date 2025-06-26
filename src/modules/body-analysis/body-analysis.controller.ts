import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
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

interface UpdateBodyAnalysisRequest {
  bodyType?: string;
  measurements?: any;
  bodyComposition?: any;
  recommendations?: any;
  aiConfidence?: number;
  notes?: string;
}

@Controller('body-analysis')
export class BodyAnalysisController {
  constructor(private readonly bodyAnalysisService: BodyAnalysisService) {}

  @Post()
  async create(
    @Body() request: BodyAnalysisRequest,
  ): Promise<ApiResponse<any>> {
    try {
      const { image, ...userData } = request;

      if (!image) {
        throw new HttpException('Imagen requerida', HttpStatus.BAD_REQUEST);
      }

      console.log('🔍 Analizando imagen corporal con IA...');

      const analysis = await this.bodyAnalysisService.analyzeBodyImage(
        image,
        userData,
      );
      console.log('Análisis generado:', analysis);
      // Guardar el análisis en la base de datos
      const savedAnalysis = await this.bodyAnalysisService.create({
        userId: 'default',
        bodyType: analysis.bodyType,
        measurements: {
          height: userData.height || 170,
          weight: userData.currentWeight || 70,
          age: userData.age || 25,
          gender: userData.gender || 'male',
        },
        bodyComposition: {
          bodyFatPercentage: analysis.measurements.estimatedBodyFat || 15,
          muscleMass: 0, // Calculamos después
          bmr: 0, // Calculamos después
        },
        recommendations: {
          dailyCalories: 2200, // Valor por defecto, se puede calcular
          macronutrients: {
            protein: 150,
            carbs: 250,
            fat: 67,
            fiber: 25,
          },
          mealPlan: analysis.recommendations.nutrition,
        },
        imageUrl: null, // Por seguridad, no guardamos la imagen
        aiConfidence: analysis.confidence,
      });

      console.log('✅ Análisis corporal completado y guardado en BD');

      return {
        success: true,
        data: {
          ...analysis,
          id: savedAnalysis.id,
          createdAt: savedAnalysis.createdAt,
        },
      };
    } catch (error) {
      console.error('❌ Error analyzing body:', error);
      throw new HttpException(
        'Error analizando la imagen corporal',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  async getAll(@Query('days') days?: string): Promise<ApiResponse<any[]>> {
    try {
      let analyses;

      if (days) {
        const daysNumber = parseInt(days) || 30;
        analyses = await this.bodyAnalysisService.getRecentAnalyses(daysNumber);
      } else {
        analyses = await this.bodyAnalysisService.getAll();
      }

      return {
        success: true,
        data: analyses,
      };
    } catch (error) {
      console.error('Error fetching body analyses:', error);
      return {
        success: false,
        data: [],
        error: 'Error obteniendo análisis corporales',
      };
    }
  }

  @Get('latest')
  async getLatest(): Promise<ApiResponse<any>> {
    try {
      const analysis = await this.bodyAnalysisService.getLatest();

      if (!analysis) {
        return {
          success: false,
          data: null,
          error: 'No se encontraron análisis corporales',
        };
      }

      return {
        success: true,
        data: analysis,
      };
    } catch (error) {
      console.error('Error fetching latest body analysis:', error);
      return {
        success: false,
        data: null,
        error: 'Error obteniendo último análisis corporal',
      };
    }
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<ApiResponse<any>> {
    try {
      const analysis = await this.bodyAnalysisService.getById(id);

      if (!analysis) {
        throw new HttpException(
          'Análisis corporal no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: analysis,
      };
    } catch (error) {
      console.error('Error fetching body analysis by id:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Error obteniendo análisis corporal',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() request: UpdateBodyAnalysisRequest,
  ): Promise<ApiResponse<any>> {
    try {
      const analysis = await this.bodyAnalysisService.update(id, request);

      if (!analysis) {
        throw new HttpException(
          'Análisis corporal no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: analysis,
      };
    } catch (error) {
      console.error('Error updating body analysis:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Error actualizando análisis corporal',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<ApiResponse<boolean>> {
    try {
      const success = await this.bodyAnalysisService.delete(id);

      if (!success) {
        throw new HttpException(
          'Análisis corporal no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: true,
      };
    } catch (error) {
      console.error('Error deleting body analysis:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Error eliminando análisis corporal',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('analyze-only')
  async analyzeOnly(
    @Body() request: BodyAnalysisRequest,
  ): Promise<ApiResponse<any>> {
    try {
      const { image, ...userData } = request;

      if (!image) {
        throw new HttpException('Imagen requerida', HttpStatus.BAD_REQUEST);
      }

      console.log(
        '🔍 Analizando imagen corporal (solo análisis, sin guardar)...',
      );

      const analysis = await this.bodyAnalysisService.analyzeBodyImage(
        image,
        userData,
      );

      console.log('✅ Análisis corporal completado');

      return {
        success: true,
        data: analysis,
      };
    } catch (error) {
      console.error('❌ Error analyzing body:', error);
      throw new HttpException(
        'Error analizando la imagen corporal',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('stats/summary')
  async getStatsSummary(): Promise<ApiResponse<any>> {
    try {
      const recentAnalyses =
        await this.bodyAnalysisService.getRecentAnalyses(30);
      const allAnalyses = await this.bodyAnalysisService.getAll();

      const summary = {
        total: allAnalyses.length,
        recent: recentAnalyses.length,
        hasLatest: recentAnalyses.length > 0,
        latestDate:
          recentAnalyses.length > 0 ? recentAnalyses[0].createdAt : null,
        avgConfidence:
          allAnalyses.length > 0
            ? allAnalyses.reduce(
                (acc, analysis) => acc + (analysis.aiConfidence || 0),
                0,
              ) / allAnalyses.length
            : 0,
      };

      return {
        success: true,
        data: summary,
      };
    } catch (error) {
      console.error('Error getting stats summary:', error);
      return {
        success: false,
        data: {},
        error: 'Error obteniendo resumen de estadísticas',
      };
    }
  }

  @Get('status/health')
  async getServiceStatus(): Promise<ApiResponse<any>> {
    try {
      return {
        success: true,
        data: {
          openaiAvailable: !!process.env.OPENAI_API_KEY,
          service: 'body-analysis',
          version: '2.0.0',
          endpoints: [
            'POST /body-analysis',
            'GET /body-analysis',
            'GET /body-analysis/latest',
            'GET /body-analysis/:id',
            'PUT /body-analysis/:id',
            'DELETE /body-analysis/:id',
            'POST /body-analysis/analyze-only',
            'GET /body-analysis/stats/summary',
            'GET /body-analysis/status/health',
          ],
          features: [
            'OpenAI Vision API integration',
            'Body composition analysis',
            'Nutrition recommendations',
            'Fitness assessment',
            'CRUD operations',
          ],
        },
      };
    } catch (error) {
      console.error('Error getting service status:', error);
      return {
        success: false,
        data: {},
        error: 'Error obteniendo estado del servicio',
      };
    }
  }
}
