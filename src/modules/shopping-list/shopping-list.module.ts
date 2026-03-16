import { Module } from '@nestjs/common';
import { ShoppingListController } from './shopping-list.controller';
import { ShoppingListService } from './shopping-list.service';
import { PrismaService } from '../../config/prisma.service';
import { AICostModule } from '../ai-cost/ai-cost.module';

@Module({
  imports: [AICostModule],
  controllers: [ShoppingListController],
  providers: [ShoppingListService, PrismaService],
})
export class ShoppingListModule {}
