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
  UseGuards,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BodyAnalysisService } from './body-analysis.service';
import { ApiResponse } from '../../common/types';
import { SaveDTO } from './dto/save-body-analysis.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

interface UpdateBodyAnalysisRequest {
  bodyType?: string;
  measurements?: any;
  bodyComposition?: any;
  recommendations?: any;
  aiConfidence?: number;
  notes?: string;
}

interface PersonalDataRequest {
  height: number;
  currentWeight: number;
  targetWeight: number;
  age: number;
  gender: 'male' | 'female' | 'other';
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  fitnessGoal: string;
  bodyAnalysisId?: string; // ID del análisis corporal para basar los cálculos
}

@Controller('body-analysis')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { ttl: 60000, limit: 10 } })
export class BodyAnalysisController {
  constructor(private readonly bodyAnalysisService: BodyAnalysisService) {}

  @Post()
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async analyze(
    @Body()
    request: {
      image: string;
      currentWeight?: number;
      targetWeight?: number;
      height?: number;
      age?: number;
      gender?: 'male' | 'female' | 'other';
      activityLevel?: string;
      goals?: string[];
    },
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
      }

      if (!request.image) {
        throw new HttpException(
          'Se requiere una imagen para el análisis',
          HttpStatus.BAD_REQUEST,
        );
      }

      console.log('🔬 Iniciando análisis corporal con OpenAI Vision...');

      const analysisResult =
        await this.bodyAnalysisService.analyzeBody(request, userId);

      // Guardar automáticamente el resultado
      const saved = await this.bodyAnalysisService.create({
        userId,
        bodyType: analysisResult.bodyType,
        measurements: analysisResult.measurements as any,
        bodyComposition: analysisResult.bodyComposition as any,
        recommendations: analysisResult.recommendations as any,
        progress: analysisResult.progress as any,
        insights: analysisResult.insights || [],
        disclaimer: analysisResult.disclaimer || '',
        aiConfidence: analysisResult.confidence || 0,
        rawAnalysis: analysisResult as any,
      } as any);

      console.log('✅ Análisis corporal completado y guardado:', saved.id);

      return {
        success: true,
        data: {
          ...analysisResult,
          savedId: saved.id,
        },
      };
    } catch (error) {
      console.error('❌ Error en análisis corporal:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Error en el análisis corporal',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('analyze-only')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async analyzeOnly(
    @Body()
    request: {
      image: string;
      currentWeight?: number;
      targetWeight?: number;
      height?: number;
      age?: number;
      gender?: 'male' | 'female' | 'other';
      activityLevel?: string;
      goals?: string[];
    },
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
      }

      if (!request.image) {
        throw new HttpException(
          'Se requiere una imagen para el análisis',
          HttpStatus.BAD_REQUEST,
        );
      }

      console.log('🔬 Iniciando análisis corporal (sin guardar)...');

      const analysisResult =
        await this.bodyAnalysisService.analyzeBody(request, userId);

      console.log('✅ Análisis corporal completado (no guardado)');

      return {
        success: true,
        data: analysisResult,
      };
    } catch (error) {
      console.error('❌ Error en análisis corporal:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Error en el análisis corporal',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('save')
  async save(@Body() request: SaveDTO, @Req() req: any): Promise<ApiResponse<any>> {
    try {
      const analysis = await this.bodyAnalysisService.save(request, req.user.userId);
      return { success: true, data: analysis };
    } catch (error) {
      console.error('Error al guardar análisis corporal:', error);

      throw new HttpException(
        'Error guardando análisis corporal',
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
      console.error('Error al obtener análisis corporales:', error);
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
      console.error('Error al obtener último análisis corporal:', error);
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
      console.error('Error al obtener análisis corporal por id:', error);

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
      console.error('Error al actualizar análisis corporal:', error);

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
      console.error('Error al eliminar análisis corporal:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Error eliminando análisis corporal',
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
      console.error('Error al obtener resumen de estadísticas:', error);
      return {
        success: false,
        data: {},
        error: 'Error obteniendo resumen de estadísticas',
      };
    }
  }

  @Post('calculate-goals')
  async calculateGoals(
    @Body() request: PersonalDataRequest,
  ): Promise<ApiResponse<any>> {
    try {
      console.log('🎯 Calculando objetivos nutricionales...');

      // Obtener análisis corporal si se proporciona ID
      let bodyAnalysis = null;
      if (request.bodyAnalysisId) {
        bodyAnalysis = await this.bodyAnalysisService.getById(
          request.bodyAnalysisId,
        );
      } else {
        // Usar el último análisis disponible
        bodyAnalysis = await this.bodyAnalysisService.getLatest();
      }

      // Calcular BMR (Basal Metabolic Rate) usando la fórmula de Mifflin-St Jeor
      let bmr: number;
      if (request.gender === 'male') {
        bmr =
          88.362 +
          13.397 * request.currentWeight +
          4.799 * request.height -
          5.677 * request.age;
      } else {
        bmr =
          447.593 +
          9.247 * request.currentWeight +
          3.098 * request.height -
          4.33 * request.age;
      }

      // Aplicar factor de actividad
      const activityFactors = {
        sedentary: 1.2,
        light: 1.375,
        moderate: 1.55,
        active: 1.725,
        very_active: 1.9,
      };

      const tdee = bmr * activityFactors[request.activityLevel];

      // Ajustar calorías según objetivo
      let dailyCalories = tdee;
      let macroSplit = { protein: 25, carbs: 45, fat: 30 }; // Por defecto

      if (bodyAnalysis?.recommendations?.macroSplit) {
        // Usar las macros recomendadas por la AI
        macroSplit = {
          protein: bodyAnalysis.recommendations.macroSplit.protein || 25,
          carbs: bodyAnalysis.recommendations.macroSplit.carbs || 45,
          fat: bodyAnalysis.recommendations.macroSplit.fat || 30,
        };
        dailyCalories = bodyAnalysis.recommendations.dailyCalories || tdee;
      } else {
        // Calcular según objetivo si no hay recomendaciones de AI
        switch (request.fitnessGoal) {
          case 'define':
            dailyCalories = tdee - 400; // Déficit para definición
            macroSplit = { protein: 40, carbs: 25, fat: 35 };
            break;
          case 'bulk':
            dailyCalories = tdee + 300; // Superávit para volumen
            macroSplit = { protein: 25, carbs: 50, fat: 25 };
            break;
          case 'lose_weight':
            dailyCalories = tdee - 500; // Déficit para pérdida
            macroSplit = { protein: 35, carbs: 30, fat: 35 };
            break;
          case 'gain_muscle':
            dailyCalories = tdee + 200; // Superávit ligero
            macroSplit = { protein: 30, carbs: 40, fat: 30 };
            break;
          default:
            dailyCalories = tdee; // Mantenimiento
        }
      }

      // Calcular gramos de macronutrientes
      const proteinGrams = Math.round(
        (dailyCalories * macroSplit.protein) / 100 / 4,
      );
      const carbsGrams = Math.round(
        (dailyCalories * macroSplit.carbs) / 100 / 4,
      );
      const fatGrams = Math.round((dailyCalories * macroSplit.fat) / 100 / 9);

      const result = {
        personalData: request,
        calculatedGoals: {
          bmr: Math.round(bmr),
          tdee: Math.round(tdee),
          dailyCalories: Math.round(dailyCalories),
          macroSplit: macroSplit,
          macroGrams: {
            protein: proteinGrams,
            carbs: carbsGrams,
            fat: fatGrams,
          },
        },
        basedOnBodyAnalysis: !!bodyAnalysis,
        bodyAnalysisUsed: bodyAnalysis
          ? {
              id: bodyAnalysis.id,
              createdAt: bodyAnalysis.createdAt,
              aiRecommendations: bodyAnalysis.recommendations,
            }
          : null,
      };

      console.log('✅ Objetivos nutricionales calculados');

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('❌ Error calculating goals:', error);
      throw new HttpException(
        'Error calculando objetivos nutricionales',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
            'POST /body-analysis/calculate-goals',
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
      console.error('Error al obtener estado del servicio:', error);
      return {
        success: false,
        data: {},
        error: 'Error obteniendo estado del servicio',
      };
    }
  }

}
