import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  HttpException,
  HttpStatus,
  Param,
  Put,
  UseGuards,
  Req, Logger } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { NutritionService } from './nutrition.service';
import {
  NutritionAnalysis,
  ApiResponse,
  WeightEntry,
  WeightEntryAnalysis,
  WeightStats,
  WeightAnalysis,
} from '../../common/types';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { XpAction } from '../xp/dto/xp.dto';
import { getLocalDateString } from '../../common/utils/date.utils';
import { XpService } from '../xp/xp.service';
import { CreateWeightEntryManualDto } from './dto/create-weight-entry.dto';

@Controller('nutrition')
@UseGuards(JwtAuthGuard)
export class NutritionController {
  private readonly logger = new Logger(NutritionController.name);

  constructor(
    private readonly nutritionService: NutritionService,
    private readonly xpService: XpService,
  ) {}

  @Get()
  async getAnalyses(
    @Query('date') date?: string,
    @Req() req?: any,
  ): Promise<ApiResponse<NutritionAnalysis[]>> {
    try {
      const userId = req?.user?.userId;
      if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
      const analyses = date
        ? await this.nutritionService.getByDate(date, userId)
        : await this.nutritionService.getAll(userId);

      return { success: true, data: analyses };
    } catch (error) {
      this.logger.error('Error al obtener análisis nutricionales:', error);
      return {
        success: false,
        error: 'Error al obtener análisis nutricionales',
      };
    }
  }

  @Get('weight-entries')
  async getWeightEntries(
    @Query('date') date?: string,
    @Req() req?: any,
  ): Promise<ApiResponse<WeightEntry[]>> {
    try {
      const userId = req?.user?.userId;
      if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
      const entries = date
        ? await this.nutritionService.getWeightEntriesByDate(date, userId)
        : await this.nutritionService.getAllWeightEntries(userId);

      return { success: true, data: entries };
    } catch (error) {
      this.logger.error('Error al obtener entradas de peso:', error);
      return {
        success: false,
        error: 'Error al obtener entradas de peso',
      };
    }
  }

  @Post()
  async create(
    @Body()
    analysisData: Omit<NutritionAnalysis, 'id' | 'createdAt' | 'updatedAt'>,
    @Req() req: any,
  ): Promise<ApiResponse<NutritionAnalysis>> {
    try {
      const analysis = await this.nutritionService.create(
        analysisData,
        req.user.userId,
      );
      this.logger.log('Análisis de nutrición creado');
      return { success: true, data: analysis };
    } catch (error) {
      this.logger.error('Error al crear análisis nutricional:', error);
      throw new HttpException(
        'Error al crear análisis nutricional',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('weight-entries/analyze-image')
  async createWeightEntry(
    @Body()
    body: { imageBase64: string },
    @Req() req: any,
  ): Promise<ApiResponse<WeightEntry>> {
    try {
      const { imageBase64 } = body || {};

      if (!imageBase64) {
        throw new HttpException(
          'La imagen en base64 es requerida',
          HttpStatus.BAD_REQUEST,
        );
      }

      const analysis = await this.nutritionService.analyzeWeightImage(
        imageBase64,
        req.user?.userId,
      );
      this.logger.log('Entrada de peso creada');
      return { success: true, data: analysis };
    } catch (error) {
      this.logger.error('Error al crear entrada de peso:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error al crear entrada de peso',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('weight-entries/analyze-manual')
  async createWeightEntryManual(
    @Body()
    data: CreateWeightEntryManualDto,
    @Req() req: any,
  ): Promise<ApiResponse<WeightEntry>> {
    try {
      const userId = req?.user?.userId;
      if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
      const analysis = await this.nutritionService.analyzeWeightManual(
        data,
        userId,
      );
      this.logger.log('Entrada de peso creada');
      return { success: true, data: analysis };
    } catch (error) {
      this.logger.error('Error al crear entrada de peso:', error);
      throw new HttpException(
        'Error al crear entrada de peso',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('weight-entries/:id')
  async getWeightEntry(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<WeightEntry>> {
    try {
      const userId = req?.user?.userId;
      const entry = await this.nutritionService.getWeightEntryById(id, userId);

      if (!entry) {
        throw new HttpException('Entrada de peso no encontrada', HttpStatus.NOT_FOUND);
      }

      return { success: true, data: entry };
    } catch (error) {
      this.logger.error('Error al obtener entrada de peso:', error);
      throw new HttpException(
        'Error al obtener entrada de peso',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('weight-entries/:id')
  async updateWeightEntry(
    @Param('id') id: string,
    @Body() data: Partial<WeightEntry>,
    @Req() req: any,
  ): Promise<ApiResponse<WeightEntry>> {
    try {
      const userId = req?.user?.userId;
      const updated = await this.nutritionService.updateWeightEntry(
        id,
        data,
        userId,
      );

      if (!updated) {
        throw new HttpException('Entrada de peso no encontrada', HttpStatus.NOT_FOUND);
      }

      return { success: true, data: updated };
    } catch (error) {
      this.logger.error('Error al actualizar entrada de peso:', error);
      throw new HttpException(
        'Error al actualizar entrada de peso',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('weight-entries/:id')
  async deleteWeightEntry(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    try {
      const userId = req?.user?.userId;
      const deleted = await this.nutritionService.deleteWeightEntry(id, userId);

      if (!deleted) {
        throw new HttpException('Entrada de peso no encontrada', HttpStatus.NOT_FOUND);
      }

      return { success: true, data: { deleted } };
    } catch (error) {
      this.logger.error('Error al eliminar entrada de peso:', error);
      throw new HttpException(
        'Error al eliminar entrada de peso',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('weight-stats')
  async getWeightStats(
    @Query('timeframe') timeframe: 'week' | 'month' | 'year' = 'month',
    @Req() req: any,
  ): Promise<ApiResponse<WeightStats>> {
    try {
      const userId = req?.user?.userId;
      const stats = await this.nutritionService.getWeightStats(
        userId,
        timeframe,
      );

      return { success: true, data: stats };
    } catch (error) {
      this.logger.error('Error al obtener estadísticas de peso:', error);
      return {
        success: false,
        error: 'Error al obtener estadísticas de peso',
      };
    }
  }

  @Get('weight-analysis')
  async getWeightAnalysis(
    @Req() req: any,
  ): Promise<ApiResponse<WeightAnalysis>> {
    try {
      const userId = req?.user?.userId;
      const analysis = await this.nutritionService.getWeightAnalysis(userId);

      return { success: true, data: analysis };
    } catch (error) {
      this.logger.error('Error al obtener análisis de peso:', error);
      return {
        success: false,
        error: 'Error al obtener análisis de peso',
      };
    }
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() analysisData: NutritionAnalysis,
  ): Promise<ApiResponse<NutritionAnalysis>> {
    try {
      const analysis = await this.nutritionService.update(id, analysisData);
      return { success: true, data: analysis };
    } catch (error) {
      this.logger.error('Error al actualizar análisis nutricional:', error);
      throw new HttpException(
        'Error al actualizar análisis nutricional',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    try {
      this.logger.log(`Eliminando análisis de nutrición con ID: ${id}`);
      if (!id) {
        throw new HttpException(
          'El ID del análisis es requerido',
          HttpStatus.BAD_REQUEST,
        );
      }

      const success = await this.nutritionService.delete(id, req.user.userId);
      this.logger.log(`Análisis de nutrición eliminado: ${success}`);
      return { success, data: { deleted: success } };
    } catch (error) {
      this.logger.error('Error al eliminar análisis nutricional:', error);
      throw new HttpException(
        'Error al eliminar análisis nutricional',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM, {
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  async evaluateDailyNutritionGoals(@Req() req: any) {
    // Procesar el día que acaba de terminar (ayer)
    try {
      const result = await this.nutritionService.updateNutritionAnalysis();
      if (result.meetsGoals) {
        // Agregar experiencia
        // TODO: Iterate over all active users instead of hardcoded ID
        const xp = await this.xpService.addXp('system', {
          action: XpAction.NUTRITION_LOG,
          xpAmount: 40,
          description: 'Cumplir el objetivo calórico/macros del día',
        });
      }
      return { success: true, data: result };
    } catch (error) {
      this.logger.error('Error al evaluar objetivos nutricionales diarios:', error);
      return {
        success: false,
        error: 'Error al evaluar objetivos nutricionales diarios',
      };
    }
  }

  @Get('daily-balance')
  async getDailyBalance(
    @Query('date') date: string,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req?.user?.userId;
      if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
      const today = date || getLocalDateString();

      const balance = await this.nutritionService.getDailyNutritionBalance(
        userId,
        today,
      );

      return { success: true, data: balance };
    } catch (error) {
      this.logger.error('Error al obtener balance nutricional diario:', error);
      return {
        success: false,
        error: 'Error al obtener balance nutricional diario',
      };
    }
  }
}
