import { Controller, Get, Post, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DayScoreService } from './day-score.service';

@Controller('day-score')
@UseGuards(JwtAuthGuard)
export class DayScoreController {
  constructor(private readonly dayScoreService: DayScoreService) {}

  // Static routes MUST come before parameterized routes

  @Get('stats/monthly')
  async monthlyStats(@Req() req: any, @Query('month') month: string) {
    const stats = await this.dayScoreService.getMonthlyStats(
      req.user.userId,
      month,
    );
    return { success: true, data: stats };
  }

  @Get('stats/streak')
  async winStreak(@Req() req: any) {
    const data = await this.dayScoreService.getWinStreak(req.user.userId);
    return { success: true, data };
  }

  @Get('range/:from/:to')
  async getRange(
    @Req() req: any,
    @Param('from') from: string,
    @Param('to') to: string,
  ) {
    const data = await this.dayScoreService.getRange(req.user.userId, from, to);
    return { success: true, data };
  }

  @Get(':date')
  async getByDate(@Req() req: any, @Param('date') date: string) {
    const data = await this.dayScoreService.getOrCalculate(
      req.user.userId,
      date,
    );
    return { success: true, data };
  }

  @Post(':date/recalculate')
  async recalculate(@Req() req: any, @Param('date') date: string) {
    const data = await this.dayScoreService.calculate(req.user.userId, date);
    return { success: true, data };
  }
}
