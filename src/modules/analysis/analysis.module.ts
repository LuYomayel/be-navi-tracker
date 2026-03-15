import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { PrismaService } from '../../config/prisma.service';
import { AICostModule } from '../ai-cost/ai-cost.module';

@Module({
  imports: [AICostModule],
  controllers: [AnalysisController],
  providers: [AnalysisService, PrismaService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
