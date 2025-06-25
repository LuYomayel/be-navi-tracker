import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [AnalysisController],
  providers: [AnalysisService, PrismaService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
