import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { CreateAnalysisDto, GetRecentAnalysisDto } from './dto/analysis.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/interfaces/auth.interface';

@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get('recent')
  async getRecentAnalyses(
    @Query() query: GetRecentAnalysisDto,
    @CurrentUser() user: User,
  ) {
    try {
      const analyses = await this.analysisService.getRecentAnalyses(
        user.id,
        query.days || 7,
      );
      return { analyses };
    } catch (error) {
      console.error('Error fetching recent analyses:', error);
      throw new HttpException(
        'Failed to fetch recent analyses',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post()
  async createAnalysis(
    @Body() createAnalysisDto: CreateAnalysisDto,
    @CurrentUser() user: User,
  ) {
    try {
      const analysis = await this.analysisService.createAnalysis(
        user.id,
        createAnalysisDto,
      );
      return { success: true, data: analysis };
    } catch (error) {
      console.error('Error creating analysis:', error);
      throw new HttpException(
        'Failed to create analysis',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
