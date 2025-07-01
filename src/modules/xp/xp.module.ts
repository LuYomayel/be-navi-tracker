import { Module } from '@nestjs/common';
import { XpController } from './xp.controller';
import { XpService } from './xp.service';
import { StreakService } from './streak.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [XpController],
  providers: [XpService, StreakService, PrismaService],
  exports: [XpService, StreakService],
})
export class XpModule {}
