import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { DeviceTokensService } from './device-tokens.service';
import { DeviceTokensController } from './device-tokens.controller';
import { PushService } from './push.service';

@Module({
  controllers: [DeviceTokensController],
  providers: [PrismaService, DeviceTokensService, PushService],
  exports: [DeviceTokensService, PushService],
})
export class DeviceTokensModule {}
