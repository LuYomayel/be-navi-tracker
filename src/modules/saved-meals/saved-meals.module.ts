import { Module } from '@nestjs/common';
import { SavedMealsService } from './saved-meals.service';
import { SavedMealsController } from './saved-meals.controller';
import { PrismaService } from '../../config/prisma.service';
import { NutritionModule } from '../nutrition/nutrition.module';
import { AICostModule } from '../ai-cost/ai-cost.module';

@Module({
  imports: [NutritionModule, AICostModule],
  controllers: [SavedMealsController],
  providers: [SavedMealsService, PrismaService],
  exports: [SavedMealsService],
})
export class SavedMealsModule {}
