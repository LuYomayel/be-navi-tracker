import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { PrismaService } from '../../config/prisma.service';

describe('ChatService', () => {
  let service: ChatService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockMessage = {
    id: 'msg-1',
    userId,
    role: 'user',
    content: 'Hello',
    timestamp: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: PrismaService,
          useValue: {
            chatMessage: {
              findMany: jest.fn(),
              create: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getAll', () => {
    it('should return messages for a specific user', async () => {
      (prisma.chatMessage.findMany as jest.Mock).mockResolvedValue([
        mockMessage,
      ]);

      const result = await service.getAll(userId);

      expect(result).toHaveLength(1);
      expect(prisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { timestamp: 'asc' },
        take: 50,
      });
    });

    it('should respect limit parameter', async () => {
      (prisma.chatMessage.findMany as jest.Mock).mockResolvedValue([]);

      await service.getAll(userId, 10);

      expect(prisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { timestamp: 'asc' },
        take: 10,
      });
    });

    it('should return empty array on error', async () => {
      (prisma.chatMessage.findMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.getAll(userId);

      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('should create a message with userId', async () => {
      (prisma.chatMessage.create as jest.Mock).mockResolvedValue(mockMessage);

      const result = await service.create(userId, 'user', 'Hello');

      expect(result).toBeDefined();
      expect(prisma.chatMessage.create).toHaveBeenCalledWith({
        data: {
          userId,
          role: 'user',
          content: 'Hello',
        },
      });
    });

    it('should throw on database error', async () => {
      (prisma.chatMessage.create as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        service.create(userId, 'user', 'Hello'),
      ).rejects.toThrow('Failed to create chat message');
    });
  });

  describe('clear', () => {
    it('should delete only messages for the specific user', async () => {
      (prisma.chatMessage.deleteMany as jest.Mock).mockResolvedValue({
        count: 5,
      });

      const result = await service.clear(userId);

      expect(result).toBe(true);
      expect(prisma.chatMessage.deleteMany).toHaveBeenCalledWith({
        where: { userId },
      });
    });

    it('should return false on error', async () => {
      (prisma.chatMessage.deleteMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.clear(userId);

      expect(result).toBe(false);
    });
  });
});
