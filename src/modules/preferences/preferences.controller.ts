import { Controller, Get, Post, Put, Body, UseGuards, Req } from '@nestjs/common';
import {
  PreferencesService,
  PreferencesDTO,
} from './preferences.service';
import { ApiResponse } from '../../common/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('preferences')
@UseGuards(JwtAuthGuard)
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  @Get()
  async getPreferences(@Req() req: any): Promise<ApiResponse<any>> {
    const preferences = await this.preferencesService.getPreferences(
      req.user.userId,
    );

    return {
      success: true,
      data: preferences,
    };
  }

  @Post()
  async setGoals(
    @Body() request: PreferencesDTO,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    const savedPreferences = await this.preferencesService.setPreferences(
      request,
      req.user.userId,
    );

    return {
      success: true,
      data: savedPreferences,
    };
  }

  @Get('goals')
  async getCurrentGoals(@Req() req: any): Promise<ApiResponse<any>> {
    const goals = await this.preferencesService.getCurrentGoals(
      req.user.userId,
    );

    if (!goals) {
      return {
        success: false,
        data: null,
        error: 'No se encontraron objetivos configurados',
      };
    }

    return {
      success: true,
      data: goals,
    };
  }

  @Get('progress')
  async getProgressData(@Req() req: any): Promise<ApiResponse<any>> {
    const progressData = await this.preferencesService.getProgressData(
      req.user.userId,
    );

    if (!progressData) {
      return {
        success: false,
        data: null,
        error: 'Datos insuficientes para calcular progreso',
      };
    }

    return {
      success: true,
      data: progressData,
    };
  }

  @Put('goals')
  async updateGoals(
    @Body()
    request: {
      dailyCalorieGoal?: number;
      proteinGoal?: number;
      carbsGoal?: number;
      fatGoal?: number;
    },
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    const updatedPreferences = await this.preferencesService.updateGoals(
      request,
      req.user.userId,
    );

    return {
      success: true,
      data: {
        dailyCalorieGoal: updatedPreferences.dailyCalorieGoal,
        proteinGoal: updatedPreferences.proteinGoal,
        carbsGoal: updatedPreferences.carbsGoal,
        fatGoal: updatedPreferences.fatGoal,
        updatedAt: updatedPreferences.updatedAt,
      },
    };
  }

  @Put('personal-data')
  async updatePersonalData(
    @Body()
    request: {
      height?: number;
      currentWeight?: number;
      targetWeight?: number;
      age?: number;
      gender?: 'male' | 'female' | 'other';
      activityLevel?:
        | 'sedentary'
        | 'light'
        | 'moderate'
        | 'active'
        | 'very_active';
    },
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    const updatedPreferences =
      await this.preferencesService.updatePersonalData(
        request,
        req.user.userId,
      );

    return {
      success: true,
      data: {
        height: updatedPreferences.height,
        currentWeight: updatedPreferences.currentWeight,
        targetWeight: updatedPreferences.targetWeight,
        age: updatedPreferences.age,
        gender: updatedPreferences.gender,
        activityLevel: updatedPreferences.activityLevel,
        updatedAt: updatedPreferences.updatedAt,
      },
    };
  }
}
