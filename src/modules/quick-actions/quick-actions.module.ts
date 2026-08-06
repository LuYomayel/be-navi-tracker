import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { HydrationModule } from '../hydration/hydration.module';
import { MealPrepModule } from '../meal-prep/meal-prep.module';
import { NotesModule } from '../notes/notes.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { QuickActionsController } from './quick-actions.controller';
import { QuickActionsService } from './quick-actions.service';

@Module({
  imports: [HydrationModule, MealPrepModule, NotesModule, ExpensesModule],
  controllers: [QuickActionsController],
  providers: [QuickActionsService, PrismaService],
})
export class QuickActionsModule {}
