import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ChatMessage } from '../../common/types';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async getAll(): Promise<ChatMessage[]> {
    try {
      const messages = await this.prisma.chatMessage.findMany({
        orderBy: { timestamp: 'asc' },
      });
      return messages as any[];
    } catch (error) {
      console.error('Error fetching chat messages:', error);
      return [];
    }
  }

  async create(
    role: 'user' | 'assistant',
    content: string,
  ): Promise<ChatMessage> {
    try {
      const message = await this.prisma.chatMessage.create({
        data: {
          role,
          content,
        },
      });
      return message as any;
    } catch (error) {
      console.error('Error creating chat message:', error);
      throw new Error('Failed to create chat message');
    }
  }

  async clear(): Promise<boolean> {
    try {
      await this.prisma.chatMessage.deleteMany({});
      return true;
    } catch (error) {
      console.error('Error clearing chat messages:', error);
      return false;
    }
  }
}
