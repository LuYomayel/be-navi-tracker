import { Module } from '@nestjs/common';
import { PhysicalActivitiesController } from './physical-activities.controller';
import { PhysicalActivitiesService } from './physical-activities.service';
import { PrismaService } from '../../config/prisma.service';
import { XpModule } from '../xp/xp.module';

@Module({
  imports: [XpModule],
  controllers: [PhysicalActivitiesController],
  providers: [PhysicalActivitiesService, PrismaService],
})
export class PhysicalActivitiesModule {}
