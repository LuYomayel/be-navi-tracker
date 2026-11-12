import { Module } from '@nestjs/common';
import { CountersController } from './counters.controller';
import { CountersService } from './counters.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [CountersController],
  providers: [CountersService, PrismaService],
  exports: [CountersService],
})
export class CountersModule {}
