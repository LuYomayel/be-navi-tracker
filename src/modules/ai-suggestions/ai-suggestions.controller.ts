import {
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { AiSuggestionsService } from './ai-suggestions.service';
import { ApiResponse } from '../../common/types';

interface SuggestionRequest {
  message: string;
  chatHistory?: Array<{ role: string; content: string }>;
  context?: any;
}

@Controller('ai-suggestions')
export class AiSuggestionsController {
  constructor(private readonly aiSuggestionsService: AiSuggestionsService) {}

  @Post()
  async generateSuggestion(
    @Body() request: SuggestionRequest,
  ): Promise<ApiResponse<any>> {
    try {
      console.log('request', request);
      const { message, chatHistory = [] } = request;

      if (!message) {
        throw new HttpException('Mensaje requerido', HttpStatus.BAD_REQUEST);
      }

      const suggestion = await this.aiSuggestionsService.generateSuggestion(
        message,
        chatHistory,
      );

      return {
        success: true,
        data: suggestion,
      };
    } catch (error) {
      console.error('Error generating AI suggestion:', error);
      throw new HttpException(
        'Error generando sugerencia',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('status')
  async getStatus(): Promise<ApiResponse<any>> {
    try {
      const status = await this.aiSuggestionsService.getStatus();
      return {
        success: true,
        data: status,
      };
    } catch (error) {
      console.error('Error getting AI status:', error);
      throw new HttpException(
        'Error obteniendo estado del servicio',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('analysis/recent')
  async getRecentAnalysis(
    @Query('days') days: string,
  ): Promise<ApiResponse<any[]>> {
    try {
      const daysNumber = parseInt(days) || 7;

      // Datos simulados para que funcione el ReadingAssistant
      const mockAnalyses = [
        {
          id: '1',
          type: 'habit_completion',
          data: {
            habitName: 'Ejercicio',
            completed: true,
            streak: 5,
            patterns: ['morning_routine', 'consistency'],
          },
          createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          metadata: {
            mood: 'energetic',
            difficulty: 'easy',
          },
        },
        {
          id: '2',
          type: 'nutrition_analysis',
          data: {
            mealType: 'breakfast',
            healthScore: 8.5,
            patterns: ['healthy_choices', 'good_timing'],
          },
          createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          metadata: {
            satisfaction: 'high',
          },
        },
      ];

      const cutoffDate = new Date(
        Date.now() - daysNumber * 24 * 60 * 60 * 1000,
      );
      const filteredAnalyses = mockAnalyses.filter(
        (analysis) => analysis.createdAt >= cutoffDate,
      );

      return {
        success: true,
        data: filteredAnalyses,
      };
    } catch (error) {
      console.error('Error getting recent analysis:', error);
      return {
        success: false,
        data: [],
        error: 'Error obteniendo análisis recientes',
      };
    }
  }
}
