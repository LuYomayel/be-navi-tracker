import { Module } from '@nestjs/common';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [PreferencesController],
  providers: [PreferencesService, PrismaService],
  exports: [PreferencesService],
})
export class PreferencesModule {}
