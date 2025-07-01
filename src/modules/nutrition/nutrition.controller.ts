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
import { NutritionAnalysis, ApiResponse } from '../../common/types';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { XpAction } from '../xp/dto/xp.dto';
import { XpService } from '../xp/xp.service';

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
