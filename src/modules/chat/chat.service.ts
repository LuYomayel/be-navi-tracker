import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ChatMessage } from '../../common/types';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private prisma: PrismaService) {}

  async getAll(userId: string, limit: number = 50): Promise<ChatMessage[]> {
    try {
      const messages = await this.prisma.chatMessage.findMany({
        where: { userId },
        orderBy: { timestamp: 'asc' },
        take: limit,
      });
      return messages as any[];
    } catch (error) {
      this.logger.error('Error fetching chat messages:', error);
      return [];
    }
  }

  async create(
    userId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<ChatMessage> {
    try {
      const message = await this.prisma.chatMessage.create({
        data: {
          userId,
          role,
          content,
        },
      });
      return message as any;
    } catch (error) {
      this.logger.error('Error creating chat message:', error);
      throw new Error('Failed to create chat message');
    }
  }

  async clear(userId: string): Promise<boolean> {
    try {
      await this.prisma.chatMessage.deleteMany({
        where: { userId },
      });
      return true;
    } catch (error) {
      this.logger.error('Error clearing chat messages:', error);
      return false;
    }
  }
}
