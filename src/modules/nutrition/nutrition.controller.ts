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
  Req,
} from '@nestjs/common';
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
import { XpService } from '../xp/xp.service';
import { CreateWeightEntryManualDto } from './dto/create-weight-entry.dto';

@Controller('nutrition')
@UseGuards(JwtAuthGuard)
export class NutritionController {
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
      const userId = req?.user?.userId || 'usr_test_id_123'; // Fallback para testing
      const analyses = date
        ? await this.nutritionService.getByDate(date, userId)
        : await this.nutritionService.getAll(userId);

      return { success: true, data: analyses };
    } catch (error) {
      console.error('Error fetching nutrition analyses:', error);
      return {
        success: false,
        error: 'Failed to fetch nutrition analyses',
      };
    }
  }

  @Get('weight-entries')
  async getWeightEntries(
    @Query('date') date?: string,
    @Req() req?: any,
  ): Promise<ApiResponse<WeightEntry[]>> {
    try {
      const userId = req?.user?.userId || 'usr_test_id_123'; // Fallback para testing
      const entries = date
        ? await this.nutritionService.getWeightEntriesByDate(date, userId)
        : await this.nutritionService.getAllWeightEntries(userId);

      return { success: true, data: entries };
    } catch (error) {
      console.error('Error fetching weight entries:', error);
      return {
        success: false,
        error: 'Failed to fetch weight entries',
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
      console.log('Análisis de nutrición creado:', analysis);
      return { success: true, data: analysis };
    } catch (error) {
      console.error('Error creating nutrition analysis:', error);
      throw new HttpException(
        'Failed to create nutrition analysis',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

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
          'imageBase64 is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const analysis = await this.nutritionService.analyzeWeightImage(
        imageBase64,
        req.user?.userId ?? 'usr_test_id_123',
      );
      console.log('Entrada de peso creada:', analysis);
      return { success: true, data: analysis };
    } catch (error) {
      console.error('Error creating weight entry:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to create weight entry',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('weight-entries/analyze-manual')
  async createWeightEntryManual(
    @Body()
    data: CreateWeightEntryManualDto,
    @Req() req: any,
  ): Promise<ApiResponse<WeightEntry>> {
    try {
      console.log('data', data, req?.user?.userId);
      const analysis = await this.nutritionService.analyzeWeightManual(
        data,
        req?.user?.userId || 'usr_test_id_123',
      );
      console.log('Entrada de peso creada:', analysis);
      return { success: true, data: analysis };
    } catch (error) {
      console.error('Error creating weight entry:', error);
      throw new HttpException(
        'Failed to create weight entry',
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
      const userId = req?.user?.userId || 'usr_test_id_123';
      const entry = await this.nutritionService.getWeightEntryById(id, userId);

      if (!entry) {
        throw new HttpException('Weight entry not found', HttpStatus.NOT_FOUND);
      }

      return { success: true, data: entry };
    } catch (error) {
      console.error('Error fetching weight entry:', error);
      throw new HttpException(
        'Failed to fetch weight entry',
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
      const userId = req?.user?.userId || 'usr_test_id_123';
      const updated = await this.nutritionService.updateWeightEntry(
        id,
        data,
        userId,
      );

      if (!updated) {
        throw new HttpException('Weight entry not found', HttpStatus.NOT_FOUND);
      }

      return { success: true, data: updated };
    } catch (error) {
      console.error('Error updating weight entry:', error);
      throw new HttpException(
        'Failed to update weight entry',
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
      const userId = req?.user?.userId || 'usr_test_id_123';
      const deleted = await this.nutritionService.deleteWeightEntry(id, userId);

      if (!deleted) {
        throw new HttpException('Weight entry not found', HttpStatus.NOT_FOUND);
      }

      return { success: true, data: { deleted } };
    } catch (error) {
      console.error('Error deleting weight entry:', error);
      throw new HttpException(
        'Failed to delete weight entry',
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
      const userId = req?.user?.userId || 'usr_test_id_123';
      const stats = await this.nutritionService.getWeightStats(
        userId,
        timeframe,
      );

      return { success: true, data: stats };
    } catch (error) {
      console.error('Error fetching weight stats:', error);
      return {
        success: false,
        error: 'Failed to fetch weight stats',
      };
    }
  }

  @Get('weight-analysis')
  async getWeightAnalysis(
    @Req() req: any,
  ): Promise<ApiResponse<WeightAnalysis>> {
    try {
      const userId = req?.user?.userId || 'usr_test_id_123';
      const analysis = await this.nutritionService.getWeightAnalysis(userId);

      return { success: true, data: analysis };
    } catch (error) {
      console.error('Error fetching weight analysis:', error);
      return {
        success: false,
        error: 'Failed to fetch weight analysis',
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
      console.error('Error updating nutrition analysis:', error);
      throw new HttpException(
        'Failed to update nutrition analysis',
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
      console.log('Eliminando análisis de nutrición con ID:', id);
      if (!id) {
        throw new HttpException(
          'Analysis ID is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const success = await this.nutritionService.delete(id, req.user.userId);
      console.log('Análisis de nutrición eliminado:', success);
      return { success, data: { deleted: success } };
    } catch (error) {
      console.error('Error deleting nutrition analysis:', error);
      throw new HttpException(
        'Failed to delete nutrition analysis',
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
        const xp = await this.xpService.addXp('usr_test_id_123', {
          action: XpAction.NUTRITION_LOG,
          xpAmount: 40,
          description: 'Cumplir el objetivo calórico/macros del día',
        });
      }
      return { success: true, data: result };
    } catch (error) {
      console.error('Error evaluating daily nutrition goals:', error);
      return {
        success: false,
        error: 'Failed to evaluate daily nutrition goals',
      };
    }
  }

  @Get('daily-balance')
  async getDailyBalance(
    @Query('date') date: string,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req?.user?.userId || 'usr_test_id_123'; // Fallback para testing
      const today = date || new Date().toISOString().split('T')[0];

      const balance = await this.nutritionService.getDailyNutritionBalance(
        userId,
        today,
      );

      return { success: true, data: balance };
    } catch (error) {
      console.error('Error fetching daily nutrition balance:', error);
      return {
        success: false,
        error: 'Failed to fetch daily nutrition balance',
      };
    }
  }
}
