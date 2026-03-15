import { Module } from '@nestjs/common';
import { SkinFoldController } from './skin-fold.controller';
import { SkinFoldService } from './skin-fold.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [SkinFoldController],
  providers: [SkinFoldService, PrismaService],
  exports: [SkinFoldService],
})
export class SkinFoldModule {}
