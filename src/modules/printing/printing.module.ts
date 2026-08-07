import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { GoalModule } from '../goal/goal.module';
import { PrintingController } from './printing.controller';
import { PrintingService } from './printing.service';

@Module({
  imports: [GoalModule],
  controllers: [PrintingController],
  providers: [PrintingService, PrismaService],
  exports: [PrintingService],
})
export class PrintingModule {}
