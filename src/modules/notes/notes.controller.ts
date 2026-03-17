import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  HttpStatus,
  HttpException,
  UseGuards,
  Req, Logger } from '@nestjs/common';
import { NotesService } from './notes.service';
import { DailyNote, ApiResponse } from '../../common/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SaveNoteDto } from './dto/save-note.dto';

@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NotesController {
  private readonly logger = new Logger(NotesController.name);

  constructor(private readonly notesService: NotesService) {}

  @Get()
  async getAll(@Req() req: any): Promise<ApiResponse<DailyNote[]>> {
    try {
      const notes = await this.notesService.getAll(req.user.userId);
      return { success: true, data: notes };
    } catch (error) {
      this.logger.error('Error fetching notes:', error);
      return {
        success: false,
        error: 'Failed to fetch notes',
      };
    }
  }

  @Post()
  async create(
    @Body() noteData: SaveNoteDto,
    @Req() req: any,
  ): Promise<ApiResponse<DailyNote>> {
    try {
      const note = await this.notesService.create(
        noteData as SaveNoteDto,
        req.user.userId,
      );
      return { success: true, data: note };
    } catch (error) {
      this.logger.error('Error creating note:', error);
      throw new HttpException(
        'Failed to create note',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put()
  async update(
    @Body() updateData: Partial<DailyNote> & { id: string },
    @Req() req: any,
  ): Promise<ApiResponse<DailyNote>> {
    try {
      const { id, ...updates } = updateData;
      const note = await this.notesService.update(id, updates, req.user.userId);
      return { success: true, data: note };
    } catch (error) {
      this.logger.error('Error updating note:', error);
      throw new HttpException(
        'Failed to update note',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete()
  async delete(
    @Query('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    try {
      if (!id) {
        throw new HttpException('Note ID is required', HttpStatus.BAD_REQUEST);
      }

      const success = await this.notesService.delete(id, req.user.userId);
      return { success, data: { deleted: success } };
    } catch (error) {
      this.logger.error('Error deleting note:', error);
      throw new HttpException(
        'Failed to delete note',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
