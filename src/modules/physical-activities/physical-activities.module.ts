import { Module } from '@nestjs/common';
import { PhysicalActivitiesController } from './physical-activities.controller';
import { PhysicalActivitiesService } from './physical-activities.service';
import { PrismaService } from '../../config/prisma.service';
import { XpModule } from '../xp/xp.module';
import { AICostModule } from '../ai-cost/ai-cost.module';

@Module({
  imports: [XpModule, AICostModule],
  controllers: [PhysicalActivitiesController],
  providers: [PhysicalActivitiesService, PrismaService],
})
export class PhysicalActivitiesModule {}
