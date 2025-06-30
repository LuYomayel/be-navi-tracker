import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { XpService } from './xp.service';
import { AddXpDto, XpStatsResponse, LevelUpResponse } from './dto/xp.dto';
import { ApiResponse } from '../../common/types';

@Controller('xp')
@UseGuards(JwtAuthGuard)
export class XpController {
  constructor(private readonly xpService: XpService) {}

  @Get('stats')
  async getXpStats(@Req() req: any): Promise<ApiResponse<XpStatsResponse>> {
    try {
      const data = await this.xpService.getXpStats(req.user.userId);

      return {
        success: true,
        data: data,
      };
    } catch (error) {
      console.error('Error fetching XP stats:', error);
      return {
        success: false,
        error: 'Failed to fetch XP stats',
      };
    }
  }

  @Post('add')
  async addXp(
    @Req() req: any,
    @Body() addXpDto: AddXpDto,
  ): Promise<ApiResponse<LevelUpResponse>> {
    try {
      const data = await this.xpService.addXp(req.user.userId, addXpDto);
      return {
        success: true,
        data: data,
      };
    } catch (error) {
      console.error('Error adding XP:', error);
      return {
        success: false,
        error: 'Failed to add XP',
      };
    }
  }

  @Post('habit-complete')
  async addHabitXp(
    @Req() req: any,
    @Body() body: { habitName: string; date?: string },
  ): Promise<ApiResponse<LevelUpResponse>> {
    try {
      const data = await this.xpService.addHabitXp(
        req.user.userId,
        body.habitName,
        body.date,
      );
      return {
        success: true,
        data: data,
      };
    } catch (error) {
      console.error('Error adding habit XP:', error);
      return {
        success: false,
        error: 'Failed to add habit XP',
      };
    }
  }

  @Post('nutrition-log')
  async addNutritionXp(
    @Req() req: any,
    @Body() body: { mealType: string; date?: string },
  ): Promise<ApiResponse<LevelUpResponse>> {
    try {
      const data = await this.xpService.addNutritionXp(
        req.user.userId,
        body.mealType,
        body.date,
      );
      return {
        success: true,
        data: data,
      };
    } catch (error) {
      console.error('Error adding nutrition XP:', error);
      return {
        success: false,
        error: 'Failed to add nutrition XP',
      };
    }
  }

  @Post('daily-comment')
  async addDailyCommentXp(
    @Req() req: any,
    @Body() body: { date?: string },
  ): Promise<ApiResponse<LevelUpResponse>> {
    try {
      const data = await this.xpService.addDailyCommentXp(
        req.user.userId,
        body.date,
      );
      return {
        success: true,
        data: data,
      };
    } catch (error) {
      console.error('Error adding daily comment XP:', error);
      return {
        success: false,
        error: 'Failed to add daily comment XP',
      };
    }
  }
}
