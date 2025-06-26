import { Module } from '@nestjs/common';
import { AnalyzeFoodController } from './analyze-food.controller';
import { AnalyzeFoodService } from './analyze-food.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [AnalyzeFoodController],
  providers: [AnalyzeFoodService, PrismaService],
})
export class AnalyzeFoodModule {}
