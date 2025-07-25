import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [NotesController],
  providers: [NotesService, PrismaService],
})
export class NotesModule {}
