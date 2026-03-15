import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MealPrepService } from './meal-prep.service';
import { ApiResponse } from '../../common/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ImportNutritionistPlanDto,
  UpdateNutritionistPlanDto,
  GenerateMealPrepDto,
  CreateMealPrepDto,
  UpdateMealPrepDto,
  UpdateSlotDto,
  MarkSlotEatenDto,
} from './dto';

@Controller('meal-prep')
@UseGuards(JwtAuthGuard)
export class MealPrepController {
  constructor(private readonly mealPrepService: MealPrepService) {}

  // ═══════════════════════════════════════════════════════════
  // NUTRITIONIST PLANS
  // ═══════════════════════════════════════════════════════════

  @Post('nutritionist-plan/import')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async importNutritionistPlan(
    @Body() dto: ImportNutritionistPlanDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      const plan = await this.mealPrepService.importNutritionistPlan(
        dto,
        userId,
      );

      return { success: true, data: plan };
    } catch (error) {
      console.error('Error importando plan del nutricionista:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Error importando plan del nutricionista',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('nutritionist-plan')
  async getAllNutritionistPlans(
    @Req() req: any,
  ): Promise<ApiResponse<any[]>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      const plans =
        await this.mealPrepService.getAllNutritionistPlans(userId);

      return { success: true, data: plans };
    } catch (error) {
      console.error('Error obteniendo planes:', error);
      return { success: false, data: [], error: 'Error obteniendo planes' };
    }
  }

  @Get('nutritionist-plan/active')
  async getActiveNutritionistPlan(
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      const plan =
        await this.mealPrepService.getActiveNutritionistPlan(userId);

      return { success: true, data: plan };
    } catch (error) {
      console.error('Error obteniendo plan activo:', error);
      return {
        success: false,
        data: null,
        error: 'Error obteniendo plan activo',
      };
    }
  }

  @Put('nutritionist-plan/:id')
  async updateNutritionistPlan(
    @Param('id') id: string,
    @Body() dto: UpdateNutritionistPlanDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      const plan = await this.mealPrepService.updateNutritionistPlan(
        id,
        dto,
        userId,
      );

      return { success: true, data: plan };
    } catch (error) {
      console.error('Error actualizando plan:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Error actualizando plan',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('nutritionist-plan/:id')
  async deleteNutritionistPlan(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<boolean>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      await this.mealPrepService.deleteNutritionistPlan(id, userId);

      return { success: true, data: true };
    } catch (error) {
      console.error('Error eliminando plan:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Error eliminando plan',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  // MEAL PREPS
  // ═══════════════════════════════════════════════════════════

  @Get()
  async getAllMealPreps(@Req() req: any): Promise<ApiResponse<any[]>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      const preps = await this.mealPrepService.getAllMealPreps(userId);

      return { success: true, data: preps };
    } catch (error) {
      console.error('Error obteniendo meal preps:', error);
      return {
        success: false,
        data: [],
        error: 'Error obteniendo meal preps',
      };
    }
  }

  @Get('active')
  async getActiveMealPrep(@Req() req: any): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      const prep = await this.mealPrepService.getActiveMealPrep(userId);

      return { success: true, data: prep };
    } catch (error) {
      console.error('Error obteniendo meal prep activo:', error);
      return {
        success: false,
        data: null,
        error: 'Error obteniendo meal prep activo',
      };
    }
  }

  @Get(':id')
  async getMealPrepById(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      const prep = await this.mealPrepService.getMealPrepById(id, userId);

      if (!prep) {
        throw new HttpException(
          'Meal prep no encontrado',
          HttpStatus.NOT_FOUND,
        );
      }

      return { success: true, data: prep };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Error obteniendo meal prep',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('generate')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async generateMealPrep(
    @Body() dto: GenerateMealPrepDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      console.log('🍽️ Generando meal prep con IA...');

      const prep = await this.mealPrepService.generateMealPrep(dto, userId);

      console.log('✅ Meal prep generado:', prep.id);

      return { success: true, data: prep };
    } catch (error) {
      console.error('Error generando meal prep:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Error generando meal prep',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post()
  async createMealPrep(
    @Body() dto: CreateMealPrepDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      const prep = await this.mealPrepService.createMealPrep(dto, userId);

      return { success: true, data: prep };
    } catch (error) {
      console.error('Error creando meal prep:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Error creando meal prep',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':id')
  async updateMealPrep(
    @Param('id') id: string,
    @Body() dto: UpdateMealPrepDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      const prep = await this.mealPrepService.updateMealPrep(
        id,
        dto,
        userId,
      );

      return { success: true, data: prep };
    } catch (error) {
      console.error('Error actualizando meal prep:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Error actualizando meal prep',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':id/slot')
  async updateSlot(
    @Param('id') id: string,
    @Body() dto: UpdateSlotDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      const prep = await this.mealPrepService.updateSlot(id, dto, userId);

      return { success: true, data: prep };
    } catch (error) {
      console.error('Error actualizando slot:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Error actualizando slot',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/eat')
  async markSlotEaten(
    @Param('id') id: string,
    @Body() dto: MarkSlotEatenDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      const result = await this.mealPrepService.markSlotEaten(
        id,
        dto,
        userId,
      );

      return { success: true, data: result };
    } catch (error) {
      console.error('Error marcando comida:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Error marcando comida',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  async deleteMealPrep(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<boolean>> {
    try {
      const userId = req.user?.userId;
      if (!userId)
        throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);

      await this.mealPrepService.deleteMealPrep(id, userId);

      return { success: true, data: true };
    } catch (error) {
      console.error('Error eliminando meal prep:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Error eliminando meal prep',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
