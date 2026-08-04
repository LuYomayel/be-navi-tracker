import {
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
  Req, Logger } from '@nestjs/common';
import { AiSuggestionsService } from './ai-suggestions.service';
import { ApiResponse } from '../../common/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

interface SuggestionRequest {
  message: string;
  chatHistory?: Array<{ role: string; content: string }>;
  context?: any;
}

@Controller('ai-suggestions')
@UseGuards(JwtAuthGuard)
export class AiSuggestionsController {
  private readonly logger = new Logger(AiSuggestionsController.name);

  constructor(private readonly aiSuggestionsService: AiSuggestionsService) {}

  @Post()
  async generateSuggestion(
    @Body() request: SuggestionRequest,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const { message, chatHistory = [] } = request;

      if (!message) {
        throw new HttpException('Mensaje requerido', HttpStatus.BAD_REQUEST);
      }

      const userId = req?.user?.userId;
      const suggestion = await this.aiSuggestionsService.generateSuggestion(
        message,
        chatHistory,
        userId,
      );

      return {
        success: true,
        data: suggestion,
      };
    } catch (error) {
      this.logger.error('Error generating AI suggestion:', error);
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
      this.logger.error('Error getting AI status:', error);
      throw new HttpException(
        'Error obteniendo estado del servicio',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
