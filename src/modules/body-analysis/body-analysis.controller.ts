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
import { SaveBodyAnalysisDto, SaveDTO } from './dto/save-body-analysis.dto';

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
  analysisType?: string;
}

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

      console.log('🔍 Creando trabajo de análisis corporal...');

      // Crear trabajo en la cola en lugar de procesar directamente
      const task = await this.bodyAnalysisService.analyzeBodyImage(
        image,
        userData,
      );

      console.log(`✅ Trabajo de análisis creado: ${task.taskId}`);

      return {
        success: true,
        data: {
          taskId: task.taskId,
          status: task.status,
          message:
            'Análisis en progreso. Usa el taskId para consultar el estado.',
        },
      };
    } catch (error) {
      console.error('❌ Error creating analysis task:', error);
      throw new HttpException(
        'Error creando trabajo de análisis corporal',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('save')
  async save(@Body() request: SaveDTO): Promise<ApiResponse<any>> {
    try {
      console.log('🔍 Guardando análisis corporal...');
      console.log(request);
      const analysis = await this.bodyAnalysisService.save(request);
      return { success: true, data: analysis };
    } catch (error) {
      console.error('Error saving body analysis:', error);

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
      console.error('Error getting service status:', error);
      return {
        success: false,
        data: {},
        error: 'Error obteniendo estado del servicio',
      };
    }
  }

  @Post('skinfold')
  async analyzeSkinFold(
    @Body()
    request: {
      imageBase64: string;
      user: { age: number; height: number; weight: number; gender: string };
    },
  ): Promise<ApiResponse<any>> {
    try {
      if (!request.imageBase64) {
        throw new HttpException(
          'Imagen requerida para análisis',
          HttpStatus.BAD_REQUEST,
        );
      }

      console.log('🔍 Creando trabajo de análisis de pliegues cutáneos...');

      // Crear trabajo en la cola para análisis de pliegues cutáneos
      const task = await this.bodyAnalysisService.analyzeBodyImage(
        `data:image/jpeg;base64,${request.imageBase64}`,
        {
          ...request.user,
          analysisType: 'skinfold',
        } as any,
      );

      console.log(
        `✅ Trabajo de análisis de pliegues cutáneos creado: ${task.taskId}`,
      );

      return {
        success: true,
        data: {
          taskId: task.taskId,
          status: task.status,
          message:
            'Análisis de pliegues cutáneos en progreso. Usa el taskId para consultar el estado.',
        },
      };
    } catch (error) {
      console.error('❌ Error creating skinfold analysis task:', error);
      throw new HttpException(
        'Error creando trabajo de análisis de pliegues cutáneos',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
