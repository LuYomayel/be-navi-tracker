import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { AICostModule } from '../ai-cost/ai-cost.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseCategorizerService } from './expense-categorizer.service';
import { CardStatementController } from './card-statement.controller';
import { CardStatementService } from './card-statement.service';

@Module({
  imports: [AICostModule],
  controllers: [ExpensesController, CardStatementController],
  providers: [
    ExpensesService,
    ExpenseCategorizerService,
    CardStatementService,
    PrismaService,
  ],
  exports: [ExpensesService, ExpenseCategorizerService],
})
export class ExpensesModule {}
