import { Module } from '@nestjs/common';
import { SweatTestController } from './sweat-test.controller';
import { SweatTestService } from './sweat-test.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [SweatTestController],
  providers: [SweatTestService, PrismaService],
  exports: [SweatTestService],
})
export class SweatTestModule {}
