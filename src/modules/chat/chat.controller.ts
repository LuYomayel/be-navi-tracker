import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Req,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatMessage, ApiResponse } from '../../common/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  async getAll(
    @Req() req: any,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse<ChatMessage[]>> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
      }
      const parsedLimit = limit ? parseInt(limit) : 50;
      const messages = await this.chatService.getAll(userId, parsedLimit);
      return { success: true, data: messages };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error fetching chat messages:', error);
      return {
        success: false,
        error: 'Failed to fetch chat messages',
      };
    }
  }

  @Post()
  async create(
    @Body() messageData: { role: 'user' | 'assistant'; content: string },
    @Req() req: any,
  ): Promise<ApiResponse<ChatMessage>> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
      }
      const { role, content } = messageData;
      if (!content || !content.trim()) {
        throw new HttpException(
          'Message content cannot be empty',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!['user', 'assistant'].includes(role)) {
        throw new HttpException(
          'Role must be "user" or "assistant"',
          HttpStatus.BAD_REQUEST,
        );
      }
      const message = await this.chatService.create(userId, role, content);
      return { success: true, data: message };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error creating chat message:', error);
      throw new HttpException(
        'Failed to create chat message',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete()
  async clear(@Req() req: any): Promise<ApiResponse<{ cleared: boolean }>> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
      }
      const success = await this.chatService.clear(userId);
      return { success, data: { cleared: success } };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error clearing chat messages:', error);
      throw new HttpException(
        'Failed to clear chat messages',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
