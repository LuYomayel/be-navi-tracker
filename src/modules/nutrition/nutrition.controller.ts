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
} from '@nestjs/common';
import { NutritionService } from './nutrition.service';
import { NutritionAnalysis, ApiResponse } from '../../common/types';

@Controller('nutrition')
export class NutritionController {
  constructor(private readonly nutritionService: NutritionService) {}

  @Get()
  async getAnalyses(
    @Query('date') date?: string,
  ): Promise<ApiResponse<NutritionAnalysis[]>> {
    try {
      const analyses = date
        ? await this.nutritionService.getByDate(date)
        : await this.nutritionService.getAll();

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
  ): Promise<ApiResponse<NutritionAnalysis>> {
    try {
      const analysis = await this.nutritionService.create(analysisData);
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
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    try {
      console.log('Eliminando análisis de nutrición con ID:', id);
      if (!id) {
        throw new HttpException(
          'Analysis ID is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const success = await this.nutritionService.delete(id);
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
}
