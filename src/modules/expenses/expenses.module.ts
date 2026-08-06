import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { AICostModule } from '../ai-cost/ai-cost.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseCategorizerService } from './expense-categorizer.service';

@Module({
  imports: [AICostModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseCategorizerService, PrismaService],
  exports: [ExpensesService, ExpenseCategorizerService],
})
export class ExpensesModule {}
