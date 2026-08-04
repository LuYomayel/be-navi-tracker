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

  private requireUserId(req: any): string {
    const userId = req.user?.userId;
    if (!userId)
      throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    return userId;
  }

  // ═══════════════════════════════════════════════════════════
  // NUTRITIONIST PLANS
  // ═══════════════════════════════════════════════════════════

  @Post('nutritionist-plan/import')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async importNutritionistPlan(
    @Body() dto: ImportNutritionistPlanDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    const plan = await this.mealPrepService.importNutritionistPlan(
      dto,
      this.requireUserId(req),
    );

    return { success: true, data: plan };
  }

  @Get('nutritionist-plan')
  async getAllNutritionistPlans(@Req() req: any): Promise<ApiResponse<any[]>> {
    const plans = await this.mealPrepService.getAllNutritionistPlans(
      this.requireUserId(req),
    );

    return { success: true, data: plans };
  }

  @Get('nutritionist-plan/active')
  async getActiveNutritionistPlan(@Req() req: any): Promise<ApiResponse<any>> {
    const plan = await this.mealPrepService.getActiveNutritionistPlan(
      this.requireUserId(req),
    );

    return { success: true, data: plan };
  }

  @Put('nutritionist-plan/:id')
  async updateNutritionistPlan(
    @Param('id') id: string,
    @Body() dto: UpdateNutritionistPlanDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    const plan = await this.mealPrepService.updateNutritionistPlan(
      id,
      dto,
      this.requireUserId(req),
    );

    return { success: true, data: plan };
  }

  @Delete('nutritionist-plan/:id')
  async deleteNutritionistPlan(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<boolean>> {
    await this.mealPrepService.deleteNutritionistPlan(
      id,
      this.requireUserId(req),
    );

    return { success: true, data: true };
  }

  // ═══════════════════════════════════════════════════════════
  // MEAL PREPS
  // ═══════════════════════════════════════════════════════════

  @Get()
  async getAllMealPreps(@Req() req: any): Promise<ApiResponse<any[]>> {
    const preps = await this.mealPrepService.getAllMealPreps(
      this.requireUserId(req),
    );

    return { success: true, data: preps };
  }

  @Get('active')
  async getActiveMealPrep(@Req() req: any): Promise<ApiResponse<any>> {
    const prep = await this.mealPrepService.getActiveMealPrep(
      this.requireUserId(req),
    );

    return { success: true, data: prep };
  }

  @Get(':id')
  async getMealPrepById(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    const prep = await this.mealPrepService.getMealPrepById(
      id,
      this.requireUserId(req),
    );

    if (!prep) {
      throw new HttpException('Meal prep no encontrado', HttpStatus.NOT_FOUND);
    }

    return { success: true, data: prep };
  }

  @Post('generate')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async generateMealPrep(
    @Body() dto: GenerateMealPrepDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    const prep = await this.mealPrepService.generateMealPrep(
      dto,
      this.requireUserId(req),
    );

    return { success: true, data: prep };
  }

  @Post()
  async createMealPrep(
    @Body() dto: CreateMealPrepDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    const prep = await this.mealPrepService.createMealPrep(
      dto,
      this.requireUserId(req),
    );

    return { success: true, data: prep };
  }

  @Put(':id')
  async updateMealPrep(
    @Param('id') id: string,
    @Body() dto: UpdateMealPrepDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    const prep = await this.mealPrepService.updateMealPrep(
      id,
      dto,
      this.requireUserId(req),
    );

    return { success: true, data: prep };
  }

  @Put(':id/slot')
  async updateSlot(
    @Param('id') id: string,
    @Body() dto: UpdateSlotDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    const prep = await this.mealPrepService.updateSlot(
      id,
      dto,
      this.requireUserId(req),
    );

    return { success: true, data: prep };
  }

  @Post(':id/eat')
  async markSlotEaten(
    @Param('id') id: string,
    @Body() dto: MarkSlotEatenDto,
    @Req() req: any,
  ): Promise<ApiResponse<any>> {
    const result = await this.mealPrepService.markSlotEaten(
      id,
      dto,
      this.requireUserId(req),
    );

    return { success: true, data: result };
  }

  @Delete(':id')
  async deleteMealPrep(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<boolean>> {
    await this.mealPrepService.deleteMealPrep(id, this.requireUserId(req));

    return { success: true, data: true };
  }
}
