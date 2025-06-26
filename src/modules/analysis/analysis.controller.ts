import { Controller, Get, Query, Post, Body } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { ApiResponse } from '../../common/types';

interface BookRecommendationRequest {
  availableTime: string;
  preferredMood: string;
  includeUserPatterns?: boolean;
}

interface ContentRecommendationRequest {
  availableTime: string;
  preferredMood: string;
  contentType: string;
  topic?: string;
  genre: string;
  includeUserPatterns?: boolean;
}

@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Post('content-recommendations')
  async getContentRecommendations(
    @Body() request: ContentRecommendationRequest,
  ): Promise<ApiResponse<any[]>> {
    try {
      const {
        availableTime,
        preferredMood,
        contentType,
        topic,
        genre,
        includeUserPatterns,
      } = request;

      // Obtener patrones del usuario si se solicita
      let userPatterns = [];
      if (includeUserPatterns) {
        userPatterns = await this.analysisService.getRecentAnalysis(7);
      }

      const contentRequest = {
        availableTime,
        preferredMood,
        contentType: contentType || 'Cualquiera',
        topic: topic || '',
        genre: genre || 'Cualquiera',
        includeUserPatterns,
      };

      const recommendations =
        await this.analysisService.getContentRecommendations(
          contentRequest,
          userPatterns,
        );

      console.log(`📚 Generando recomendaciones para:`, {
        tiempo: availableTime,
        mood: preferredMood,
        tipo: contentType,
        tema: topic,
        genero: genre,
        resultados: recommendations.length,
      });

      return {
        success: true,
        data: recommendations,
      };
    } catch (error) {
      console.error('Error getting content recommendations:', error);
      return {
        success: false,
        data: [],
        error: 'Error generando recomendaciones de contenido',
      };
    }
  }

  @Post('book-recommendations')
  async getBookRecommendations(
    @Body() request: BookRecommendationRequest,
  ): Promise<ApiResponse<any[]>> {
    try {
      const { availableTime, preferredMood, includeUserPatterns } = request;

      // Obtener patrones del usuario si se solicita
      let userPatterns = [];
      if (includeUserPatterns) {
        userPatterns = await this.analysisService.getRecentAnalysis(7);
      }

      const recommendations = await this.analysisService.getBookRecommendations(
        availableTime,
        preferredMood,
        userPatterns,
      );

      return {
        success: true,
        data: recommendations,
      };
    } catch (error) {
      console.error('Error getting book recommendations:', error);
      return {
        success: false,
        data: [],
        error: 'Error generando recomendaciones de libros',
      };
    }
  }

  @Get('recent')
  async getRecentAnalysis(
    @Query('days') days: string,
  ): Promise<ApiResponse<any[]>> {
    try {
      const daysNumber = parseInt(days) || 7;
      const analyses = await this.analysisService.getRecentAnalysis(daysNumber);

      return {
        success: true,
        data: analyses,
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

  @Get('patterns')
  async getPatterns(): Promise<ApiResponse<any>> {
    try {
      const patterns = await this.analysisService.detectPatterns();

      return {
        success: true,
        data: patterns,
      };
    } catch (error) {
      console.error('Error detecting patterns:', error);
      return {
        success: false,
        data: {},
        error: 'Error detectando patrones',
      };
    }
  }

  @Get('status')
  async getStatus(): Promise<ApiResponse<any>> {
    try {
      return {
        success: true,
        data: {
          openaiAvailable: !!process.env.OPENAI_API_KEY,
          endpoints: [
            'POST /analysis/content-recommendations',
            'POST /analysis/book-recommendations',
            'GET /analysis/recent',
            'GET /analysis/patterns',
            'GET /analysis/status',
          ],
          version: '2.0.0',
        },
      };
    } catch (error) {
      console.error('Error getting status:', error);
      return {
        success: false,
        data: {},
        error: 'Error obteniendo estado del servicio',
      };
    }
  }
}
