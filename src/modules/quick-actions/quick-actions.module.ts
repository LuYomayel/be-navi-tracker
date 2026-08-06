import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { HydrationModule } from '../hydration/hydration.module';
import { MealPrepModule } from '../meal-prep/meal-prep.module';
import { NotesModule } from '../notes/notes.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { AnalyzeFoodModule } from '../analyze-food/analyze-food.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { PhysicalActivitiesModule } from '../physical-activities/physical-activities.module';
import { SleepModule } from '../sleep/sleep.module';
import { QuickActionsController } from './quick-actions.controller';
import { QuickActionsConfigController } from './quick-actions-config.controller';
import { QuickActionsService } from './quick-actions.service';

@Module({
  imports: [
    HydrationModule,
    MealPrepModule,
    NotesModule,
    ExpensesModule,
    AnalyzeFoodModule,
    NutritionModule,
    PhysicalActivitiesModule,
    SleepModule,
  ],
  controllers: [QuickActionsController, QuickActionsConfigController],
  providers: [QuickActionsService, PrismaService],
})
export class QuickActionsModule {}
