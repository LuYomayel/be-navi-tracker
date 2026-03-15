import { Test, TestingModule } from '@nestjs/testing';
import { CompletionsService } from './completions.service';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';

describe('CompletionsService', () => {
  let service: CompletionsService;
  let prisma: PrismaService;
  let xpService: XpService;

  const userId = 'user-1';

  const mockCompletion = {
    id: 'completion-1',
    activityId: 'activity-1',
    date: '2024-01-15',
    completed: true,
    notes: null,
    createdAt: new Date('2024-01-15'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompletionsService,
        {
          provide: PrismaService,
          useValue: {
            dailyCompletion: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            activity: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: XpService,
          useValue: {
            addHabitXp: jest.fn().mockResolvedValue({
              newLevel: 1,
              xpEarned: 10,
              totalXpEarned: 10,
              leveledUp: false,
              nextLevelXp: 100,
              streak: 1,
              streakBonus: 0,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<CompletionsService>(CompletionsService);
    prisma = module.get<PrismaService>(PrismaService);
    xpService = module.get<XpService>(XpService);
  });

  describe('getAll', () => {
    it('should return completions filtered by userId', async () => {
      (prisma.dailyCompletion.findMany as jest.Mock).mockResolvedValue([
        mockCompletion,
      ]);

      const result = await service.getAll('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('completion-1');
      expect(prisma.dailyCompletion.findMany).toHaveBeenCalledWith({
        where: { activity: { userId: 'user-1' } },
        orderBy: { date: 'desc' },
      });
    });

    it('should return empty array on error', async () => {
      (prisma.dailyCompletion.findMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.getAll('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('toggle', () => {
    it('should create a new completion when none exists', async () => {
      (prisma.dailyCompletion.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.dailyCompletion.create as jest.Mock).mockResolvedValue(
        mockCompletion,
      );
      (prisma.activity.findUnique as jest.Mock).mockResolvedValue({
        name: 'Exercise',
      });

      const result = await service.toggle('activity-1', '2024-01-15', userId);

      expect(result.completed).toBe(true);
      expect(prisma.dailyCompletion.create).toHaveBeenCalledWith({
        data: {
          activityId: 'activity-1',
          date: '2024-01-15',
          completed: true,
        },
      });
    });

    it('should toggle existing completion from true to false', async () => {
      const existing = { ...mockCompletion, completed: true };
      const toggled = { ...mockCompletion, completed: false };

      (prisma.dailyCompletion.findUnique as jest.Mock).mockResolvedValue(
        existing,
      );
      (prisma.dailyCompletion.update as jest.Mock).mockResolvedValue(toggled);

      const result = await service.toggle('activity-1', '2024-01-15', userId);

      expect(result.completed).toBe(false);
      expect(prisma.dailyCompletion.update).toHaveBeenCalledWith({
        where: { id: 'completion-1' },
        data: { completed: false },
      });
    });

    it('should toggle existing completion from false to true and add XP', async () => {
      const existing = { ...mockCompletion, completed: false };
      const toggled = { ...mockCompletion, completed: true };

      (prisma.dailyCompletion.findUnique as jest.Mock).mockResolvedValue(
        existing,
      );
      (prisma.dailyCompletion.update as jest.Mock).mockResolvedValue(toggled);
      (prisma.activity.findUnique as jest.Mock).mockResolvedValue({
        name: 'Exercise',
      });

      const result = await service.toggle('activity-1', '2024-01-15', userId);

      expect(result.completed).toBe(true);
      expect(xpService.addHabitXp).toHaveBeenCalledWith(
        userId,
        'Exercise',
        '2024-01-15',
      );
    });

    it('should not add XP when toggling to false', async () => {
      const existing = { ...mockCompletion, completed: true };
      const toggled = { ...mockCompletion, completed: false };

      (prisma.dailyCompletion.findUnique as jest.Mock).mockResolvedValue(
        existing,
      );
      (prisma.dailyCompletion.update as jest.Mock).mockResolvedValue(toggled);

      await service.toggle('activity-1', '2024-01-15', userId);

      expect(xpService.addHabitXp).not.toHaveBeenCalled();
    });

    it('should not fail completion if XP service throws', async () => {
      (prisma.dailyCompletion.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.dailyCompletion.create as jest.Mock).mockResolvedValue(
        mockCompletion,
      );
      (prisma.activity.findUnique as jest.Mock).mockResolvedValue({
        name: 'Exercise',
      });
      (xpService.addHabitXp as jest.Mock).mockRejectedValue(
        new Error('XP error'),
      );

      const result = await service.toggle('activity-1', '2024-01-15', userId);

      expect(result.completed).toBe(true);
    });

    it('should return fallback completion on DB error', async () => {
      (prisma.dailyCompletion.findUnique as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.toggle('activity-1', '2024-01-15', userId);

      expect(result.activityId).toBe('activity-1');
      expect(result.date).toBe('2024-01-15');
      expect(result.completed).toBe(true);
    });
  });

  describe('getForActivity', () => {
    it('should return completions for a date range', async () => {
      (prisma.dailyCompletion.findMany as jest.Mock).mockResolvedValue([
        mockCompletion,
      ]);

      const result = await service.getForActivity(
        'activity-1',
        '2024-01-01',
        '2024-01-31',
      );

      expect(result).toHaveLength(1);
      expect(prisma.dailyCompletion.findMany).toHaveBeenCalledWith({
        where: {
          activityId: 'activity-1',
          date: { gte: '2024-01-01', lte: '2024-01-31' },
        },
      });
    });

    it('should return empty array on error', async () => {
      (prisma.dailyCompletion.findMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.getForActivity(
        'activity-1',
        '2024-01-01',
        '2024-01-31',
      );

      expect(result).toEqual([]);
    });
  });
});
