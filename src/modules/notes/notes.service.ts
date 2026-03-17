import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { DailyNote, ApiResponse } from '../../common/types';
import { SaveNoteDto } from './dto/save-note.dto';

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(private prisma: PrismaService) {}

  async getAll(userId: string): Promise<DailyNote[]> {
    try {
      const notes = await this.prisma.note.findMany({
        where: { user: { id: userId } },
        orderBy: { createdAt: 'asc' },
      });

      return notes.map((note) => ({
        ...note,
        predefinedComments: (note.predefinedComments as string[] | null) ?? undefined,
        customComment: note.customComment ?? undefined,
      }));
    } catch (error) {
      this.logger.error('Error al obtener notas:', error);
      return [];
    }
  }

  async create(data: SaveNoteDto, userId: string): Promise<DailyNote> {
    try {
      const {
        /* strip relation fields */ user: _u,
        userId: _uid,
        ...cleanData
      } = data as any;
      const note = await this.prisma.note.create({
        data: {
          ...cleanData,
          userId,
        },
      });

      return {
        ...note,
        predefinedComments: (note.predefinedComments as string[] | null) ?? undefined,
        customComment: note.customComment ?? undefined,
      };
    } catch (error) {
      this.logger.error('Error al crear nota:', error);
      throw new Error('Error al crear nota');
    }
  }

  async update(
    id: string,
    data: Partial<Omit<DailyNote, 'user' | 'userId'>>,
    userId: string,
  ): Promise<DailyNote | null> {
    try {
      const { user: _u, userId: _uid, ...cleanData } = data as any;

      const note = await this.prisma.note.update({
        where: { id },
        data: {
          ...cleanData,
          updatedAt: new Date(),
          userId,
        },
      });

      return {
        ...note,
        predefinedComments: (note.predefinedComments as string[] | null) ?? undefined,
        customComment: note.customComment ?? undefined,
      };
    } catch (error) {
      this.logger.error('Error al actualizar nota:', error);
      return null;
    }
  }

  async delete(id: string, userId: string): Promise<boolean> {
    try {
      await this.prisma.note.deleteMany({
        where: { id, userId },
      });
      return true;
    } catch (error) {
      this.logger.error('Error al eliminar nota:', error);
      return false;
    }
  }
}
