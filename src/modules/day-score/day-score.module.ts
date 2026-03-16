import { Module } from '@nestjs/common';
import { DayScoreController } from './day-score.controller';
import { DayScoreService } from './day-score.service';
import { PrismaService } from '../../config/prisma.service';
import { XpModule } from '../xp/xp.module';

@Module({
  imports: [XpModule],
  controllers: [DayScoreController],
  providers: [DayScoreService, PrismaService],
  exports: [DayScoreService],
})
export class DayScoreModule {}
