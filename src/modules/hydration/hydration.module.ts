import { Module } from '@nestjs/common';
import { HydrationController } from './hydration.controller';
import { HydrationService } from './hydration.service';
import { PrismaService } from '../../config/prisma.service';
import { XpModule } from '../xp/xp.module';
import { DeviceTokensModule } from '../device-tokens/device-tokens.module';
import { HydrationCronService } from './hydration-cron.service';
import { SweatTestModule } from '../sweat-test/sweat-test.module';

@Module({
  imports: [XpModule, DeviceTokensModule, SweatTestModule],
  controllers: [HydrationController],
  providers: [HydrationService, HydrationCronService, PrismaService],
  exports: [HydrationService],
})
export class HydrationModule {}
