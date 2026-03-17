import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  UseGuards,
  HttpException,
  HttpStatus, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DayScoreService } from './day-score.service';

@Controller('day-score')
@UseGuards(JwtAuthGuard)
export class DayScoreController {
  private readonly logger = new Logger(DayScoreController.name);

  constructor(private readonly dayScoreService: DayScoreService) {}

  // Static routes MUST come before parameterized routes

  @Get('stats/monthly')
  async monthlyStats(@Req() req: any, @Query('month') month: string) {
    try {
      const stats = await this.dayScoreService.getMonthlyStats(
        req.user.userId,
        month,
      );
      return { success: true, data: stats };
    } catch (error) {
      this.logger.error('Error fetching monthly stats:', error);
      return { success: false, error: 'Error fetching monthly stats' };
    }
  }

  @Get('stats/streak')
  async winStreak(@Req() req: any) {
    try {
      const data = await this.dayScoreService.getWinStreak(
        req.user.userId,
      );
      return { success: true, data };
    } catch (error) {
      this.logger.error('Error fetching win streak:', error);
      return { success: false, error: 'Error fetching win streak' };
    }
  }

  @Get('range/:from/:to')
  async getRange(
    @Req() req: any,
    @Param('from') from: string,
    @Param('to') to: string,
  ) {
    try {
      const data = await this.dayScoreService.getRange(
        req.user.userId,
        from,
        to,
      );
      return { success: true, data };
    } catch (error) {
      this.logger.error('Error fetching day score range:', error);
      return {
        success: false,
        error: 'Error fetching day score range',
      };
    }
  }

  @Get(':date')
  async getByDate(@Req() req: any, @Param('date') date: string) {
    try {
      const data = await this.dayScoreService.getOrCalculate(
        req.user.userId,
        date,
      );
      return { success: true, data };
    } catch (error) {
      this.logger.error('Error fetching day score:', error);
      return { success: false, error: 'Error fetching day score' };
    }
  }

  @Post(':date/recalculate')
  async recalculate(@Req() req: any, @Param('date') date: string) {
    try {
      const data = await this.dayScoreService.calculate(
        req.user.userId,
        date,
      );
      return { success: true, data };
    } catch (error) {
      this.logger.error('Error recalculating day score:', error);
      throw new HttpException(
        'Error recalculating day score',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
