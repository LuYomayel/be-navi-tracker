import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  PreferencesService,
  PreferencesDTO,
  SetPreferencesRequest,
} from './preferences.service';
import { ApiResponse } from '../../common/types';
import { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('preferences')
@UseGuards(JwtAuthGuard)
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  @Get()
  async getPreferences(@Req() req: any): Promise<ApiResponse<any>> {
    try {
      const preferences = await this.preferencesService.getPreferences(
        req.user.userId,
      );

      return {
        success: true,
        data: preferences,
      };
    } catch (error) {
      console.error('Error fetching preferences:', error);
      return {
        success: false,
        data: null,
        error: 'Error obteniendo preferencias del usuario',
      };
    }
  }

  @Post()
  async setGoals(
    @Body() request: PreferencesDTO,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      console.log('🎯 Guardando preferencias y objetivos del usuario...');
      console.log('📋 Request recibido:', JSON.stringify(request, null, 2));
      console.log('📋 User ID:', req.user.userId);
      const savedPreferences = await this.preferencesService.setPreferences(
        request,
        req.user.userId,
      );
      console.log(savedPreferences);
      console.log('✅ Preferencias guardadas exitosamente');
      /*
      return {
        success: true,
        data: {
          id: savedPreferences.id,
          goals: {
            dailyCalories: savedPreferences.dailyCalorieGoal,
            protein: savedPreferences.proteinGoal,
            carbs: savedPreferences.carbsGoal,
            fat: savedPreferences.fatGoal,
            fiber: savedPreferences.fiberGoal,
          },
          personalData: {
            height: savedPreferences.height,
            currentWeight: savedPreferences.currentWeight,
            targetWeight: savedPreferences.targetWeight,
            age: savedPreferences.age,
            gender: savedPreferences.gender,
            activityLevel: savedPreferences.activityLevel,
            fitnessGoals: savedPreferences.fitnessGoals,
          },
          bodyAnalysis: {
            lastAnalysisId: savedPreferences.lastBodyAnalysisId,
          },
          updatedAt: savedPreferences.updatedAt,
        },
      };
      */
      return {
        success: true,
        data: savedPreferences,
      };
    } catch (error) {
      console.error('❌ Error saving preferences:', error);
      throw new HttpException(
        'Error guardando preferencias del usuario',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('goals')
  async getCurrentGoals(@Req() req: any): Promise<ApiResponse<any>> {
    try {
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
    } catch (error) {
      console.error('Error fetching current goals:', error);
      return {
        success: false,
        data: null,
        error: 'Error obteniendo objetivos actuales',
      };
    }
  }

  @Get('progress')
  async getProgressData(@Req() req: any): Promise<ApiResponse<any>> {
    try {
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
    } catch (error) {
      console.error('Error fetching progress data:', error);
      return {
        success: false,
        data: null,
        error: 'Error obteniendo datos de progreso',
      };
    }
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
    console.log(req.user.userId);
    try {
      console.log('🎯 Actualizando objetivos nutricionales...');

      const updatedPreferences = await this.preferencesService.updateGoals(
        request,
        req.user.userId,
      );

      console.log('✅ Objetivos actualizados exitosamente');

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
    } catch (error) {
      console.error('❌ Error updating goals:', error);
      throw new HttpException(
        'Error actualizando objetivos nutricionales',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
    try {
      console.log('👤 Actualizando datos personales...');

      const updatedPreferences =
        await this.preferencesService.updatePersonalData(
          request,
          req.user.userId,
        );

      console.log('✅ Datos personales actualizados exitosamente');

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
    } catch (error) {
      console.error('❌ Error updating personal data:', error);
      throw new HttpException(
        'Error actualizando datos personales',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
