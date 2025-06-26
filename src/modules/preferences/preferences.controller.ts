import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  PreferencesService,
  SetPreferencesRequest,
} from './preferences.service';
import { ApiResponse } from '../../common/types';

@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  @Get()
  async getPreferences(): Promise<ApiResponse<any>> {
    try {
      const preferences = await this.preferencesService.getPreferences();

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
    @Body() request: SetPreferencesRequest,
  ): Promise<ApiResponse<any>> {
    try {
      console.log('🎯 Guardando preferencias y objetivos del usuario...');
      console.log('📋 Request recibido:', JSON.stringify(request, null, 2));

      const savedPreferences =
        await this.preferencesService.setPreferences(request);

      console.log('✅ Preferencias guardadas exitosamente');

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
    } catch (error) {
      console.error('❌ Error saving preferences:', error);
      throw new HttpException(
        'Error guardando preferencias del usuario',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('goals')
  async getCurrentGoals(): Promise<ApiResponse<any>> {
    try {
      const goals = await this.preferencesService.getCurrentGoals();

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
  async getProgressData(): Promise<ApiResponse<any>> {
    try {
      const progressData = await this.preferencesService.getProgressData();

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
  ): Promise<ApiResponse<any>> {
    try {
      console.log('🎯 Actualizando objetivos nutricionales...');

      const updatedPreferences =
        await this.preferencesService.updateGoals(request);

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
  ): Promise<ApiResponse<any>> {
    try {
      console.log('👤 Actualizando datos personales...');

      const updatedPreferences =
        await this.preferencesService.updatePersonalData(request);

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
