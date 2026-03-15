import { Module } from '@nestjs/common';
import { MealPrepController } from './meal-prep.controller';
import { MealPrepService } from './meal-prep.service';
import { PrismaService } from '../../config/prisma.service';
import { AICostModule } from '../ai-cost/ai-cost.module';
import { SavedMealsModule } from '../saved-meals/saved-meals.module';
import { NutritionModule } from '../nutrition/nutrition.module';

@Module({
  imports: [AICostModule, SavedMealsModule, NutritionModule],
  controllers: [MealPrepController],
  providers: [MealPrepService, PrismaService],
  exports: [MealPrepService],
})
export class MealPrepModule {}
