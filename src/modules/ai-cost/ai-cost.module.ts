import { Module } from '@nestjs/common';
import { AICostService } from './ai-cost.service';
import { AICostController } from './ai-cost.controller';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [AICostController],
  providers: [AICostService, PrismaService],
  exports: [AICostService],
})
export class AICostModule {}
