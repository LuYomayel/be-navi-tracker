import { Module } from '@nestjs/common';
import { NutritionController } from './nutrition.controller';
import { NutritionService } from './nutrition.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [NutritionController],
  providers: [NutritionService, PrismaService],
})
export class NutritionModule {}
