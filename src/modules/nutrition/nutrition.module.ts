import { Module } from '@nestjs/common';
import { NutritionController } from './nutrition.controller';
import { NutritionService } from './nutrition.service';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';

@Module({
  controllers: [NutritionController],
  providers: [NutritionService, PrismaService, XpService],
})
export class NutritionModule {}
