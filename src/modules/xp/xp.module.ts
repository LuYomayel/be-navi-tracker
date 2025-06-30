import { Module } from '@nestjs/common';
import { XpController } from './xp.controller';
import { XpService } from './xp.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [XpController],
  providers: [XpService, PrismaService],
  exports: [XpService],
})
export class XpModule {}
