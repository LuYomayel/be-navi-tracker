import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { DailyNote, ApiResponse } from '../../common/types';
import { SaveNoteDto } from './dto/save-note.dto';

@Injectable()
export class NotesService {
  constructor(private prisma: PrismaService) {}

  async getAll(userId: string): Promise<DailyNote[]> {
    try {
      const notes = await this.prisma.note.findMany({
        where: { user: { id: userId } },
        orderBy: { createdAt: 'asc' },
      });

      return notes;
    } catch (error) {
      console.error('Error fetching notes:', error);
      return [];
    }
  }

  async create(data: SaveNoteDto, userId: string): Promise<DailyNote> {
    try {
      const {
        /* strip relation fields */ user: _u,
        userId: _uid,
        predefinedComments: _predefinedComments,
        ...cleanData
      } = data as any;
      console.log('cleanData', cleanData);
      const note = await this.prisma.note.create({
        data: {
          ...cleanData,
          userId,
        },
      });

      return {
        ...note,
      };
    } catch (error) {
      console.error('Error creating note:', error);
      throw new Error('Failed to create note');
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
      };
    } catch (error) {
      console.error('Error updating note:', error);
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.note.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      console.error('Error deleting note:', error);
      return false;
    }
  }
}
