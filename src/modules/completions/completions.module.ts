import { Module } from '@nestjs/common';
import { CompletionsController } from './completions.controller';
import { CompletionsService } from './completions.service';
import { PrismaService } from '../../config/prisma.service';
import { XpModule } from '../xp/xp.module';

@Module({
  imports: [XpModule],
  controllers: [CompletionsController],
  providers: [CompletionsService, PrismaService],
  exports: [CompletionsService],
})
export class CompletionsModule {}
