import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatMessage, ApiResponse } from '../../common/types';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  async getAll(): Promise<ApiResponse<ChatMessage[]>> {
    try {
      const messages = await this.chatService.getAll();
      return { success: true, data: messages };
    } catch (error) {
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
  ): Promise<ApiResponse<ChatMessage>> {
    try {
      const { role, content } = messageData;
      const message = await this.chatService.create(role, content);
      return { success: true, data: message };
    } catch (error) {
      console.error('Error creating chat message:', error);
      throw new HttpException(
        'Failed to create chat message',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete()
  async clear(): Promise<ApiResponse<{ cleared: boolean }>> {
    try {
      const success = await this.chatService.clear();
      return { success, data: { cleared: success } };
    } catch (error) {
      console.error('Error clearing chat messages:', error);
      throw new HttpException(
        'Failed to clear chat messages',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
