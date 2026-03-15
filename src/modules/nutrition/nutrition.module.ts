import { Module } from '@nestjs/common';
import { NutritionController } from './nutrition.controller';
import { NutritionService } from './nutrition.service';
import { PrismaService } from '../../config/prisma.service';
import { XpModule } from '../xp/xp.module';
import { AICostModule } from '../ai-cost/ai-cost.module';

@Module({
  imports: [XpModule, AICostModule],
  controllers: [NutritionController],
  providers: [NutritionService, PrismaService],
  exports: [NutritionService],
})
export class NutritionModule {}
