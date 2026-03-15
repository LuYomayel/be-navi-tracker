import { Controller, Get, Query, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { ApiResponse } from '../../common/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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
@UseGuards(JwtAuthGuard)
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Post('content-recommendations')
  async getContentRecommendations(
    @Body() request: ContentRecommendationRequest,
    @Req() req: any,
  ): Promise<ApiResponse<any[]>> {
    try {
      const userId = req.user?.userId;
      const {
        availableTime,
        preferredMood,
        contentType,
        topic,
        genre,
        includeUserPatterns,
      } = request;

      let userPatterns = [];
      if (includeUserPatterns && userId) {
        userPatterns = await this.analysisService.getRecentAnalysis(userId, 7);
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
    @Req() req: any,
  ): Promise<ApiResponse<any[]>> {
    try {
      const userId = req.user?.userId;
      const { availableTime, preferredMood, includeUserPatterns } = request;

      let userPatterns = [];
      if (includeUserPatterns && userId) {
        userPatterns = await this.analysisService.getRecentAnalysis(userId, 7);
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
    @Req() req: any,
  ): Promise<ApiResponse<any[]>> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return { success: false, data: [], error: 'Unauthorized' };
      }
      const daysNumber = parseInt(days) || 7;
      const analyses = await this.analysisService.getRecentAnalysis(userId, daysNumber);

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
  async getPatterns(@Req() req: any): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return { success: false, data: {}, error: 'Unauthorized' };
      }
      const patterns = await this.analysisService.detectPatterns(userId);

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
  }
}
