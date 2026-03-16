import { Module } from '@nestjs/common';
import { HydrationController } from './hydration.controller';
import { HydrationService } from './hydration.service';
import { PrismaService } from '../../config/prisma.service';
import { XpModule } from '../xp/xp.module';

@Module({
  imports: [XpModule],
  controllers: [HydrationController],
  providers: [HydrationService, PrismaService],
  exports: [HydrationService],
})
export class HydrationModule {}
