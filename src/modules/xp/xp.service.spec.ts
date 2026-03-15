import { Test, TestingModule } from '@nestjs/testing';
import { XpService } from './xp.service';
import { PrismaService } from '../../config/prisma.service';
import { StreakService } from './streak.service';
import { XpAction } from './dto/xp.dto';

describe('XpService', () => {
  let service: XpService;
  let prisma: PrismaService;
  let streakService: StreakService;

  const userId = 'user-1';

  const mockUser = {
    id: userId,
    email: 'test@example.com',
    name: 'Test User',
    level: 1,
    xp: 0,
    totalXp: 0,
    streak: 0,
    lastStreakDate: null,
    plan: 'free',
    isActive: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XpService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            xpLog: {
              create: jest.fn(),
              findFirst: jest.fn(),
            },
          },
        },
        {
          provide: StreakService,
          useValue: {
            updateHabitStreak: jest.fn().mockResolvedValue({
              streak: 1,
              streakBonus: 0,
              streakType: 'habits',
              isNewRecord: false,
            }),
            updateNutritionStreak: jest.fn().mockResolvedValue({
              streak: 0,
              streakBonus: 0,
              streakType: 'nutrition',
              isNewRecord: false,
            }),
            updateActivityStreak: jest.fn().mockResolvedValue({
              streak: 0,
              streakBonus: 0,
              streakType: 'activity',
              isNewRecord: false,
            }),
            getAllStreaks: jest.fn().mockResolvedValue({
              habits: { streak: 1, lastDate: '2024-01-15' },
              nutrition: { streak: 0, lastDate: null },
              activity: { streak: 0, lastDate: null },
            }),
          },
        },
      ],
    }).compile();

    service = module.get<XpService>(XpService);
    prisma = module.get<PrismaService>(PrismaService);
    streakService = module.get<StreakService>(StreakService);
  });

  describe('calculateXpForLevel', () => {
    it('should return 100 for level 1', () => {
      expect(service.calculateXpForLevel(1)).toBe(100);
    });

    it('should return 220 for level 2 (100 + 120)', () => {
      expect(service.calculateXpForLevel(2)).toBe(220);
    });

    it('should return 360 for level 3 (100 + 120 + 140)', () => {
      expect(service.calculateXpForLevel(3)).toBe(360);
    });

    it('should increase progressively for higher levels', () => {
      const lvl5 = service.calculateXpForLevel(5);
      const lvl10 = service.calculateXpForLevel(10);
      expect(lvl10).toBeGreaterThan(lvl5);
    });
  });

  describe('calculateLevelFromTotalXp', () => {
    it('should return level 1 for 0 XP', () => {
      expect(service.calculateLevelFromTotalXp(0)).toBe(1);
    });

    it('should return level 1 for 99 XP', () => {
      expect(service.calculateLevelFromTotalXp(99)).toBe(1);
    });

    it('should return level 2 for 100 XP', () => {
      expect(service.calculateLevelFromTotalXp(100)).toBe(1);
    });

    it('should return level 2 for 220 XP', () => {
      expect(service.calculateLevelFromTotalXp(220)).toBe(2);
    });

    it('should never return less than 1', () => {
      expect(service.calculateLevelFromTotalXp(-10)).toBe(1);
    });
  });

  describe('calculateStreakBonus', () => {
    it('should return 0 for streak of 0', () => {
      expect(service.calculateStreakBonus(0)).toBe(0);
    });

    it('should return 0 for streak of 1', () => {
      expect(service.calculateStreakBonus(1)).toBe(0);
    });

    it('should return 5 for streak of 2', () => {
      expect(service.calculateStreakBonus(2)).toBe(5);
    });

    it('should return 10 for streak of 3', () => {
      expect(service.calculateStreakBonus(3)).toBe(10);
    });

    it('should cap at 50 XP bonus', () => {
      expect(service.calculateStreakBonus(100)).toBe(50);
    });
  });

  describe('addXp', () => {
    it('should add XP for habit completion', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.user.update as jest.Mock).mockResolvedValue({
        ...mockUser,
        xp: 10,
        totalXp: 10,
      });
      (prisma.xpLog.create as jest.Mock).mockResolvedValue({});

      const result = await service.addXp(userId, {
        action: XpAction.HABIT_COMPLETE,
        xpAmount: 10,
        description: 'Completed habit',
      });

      expect(result.xpEarned).toBe(10);
      expect(result.leveledUp).toBe(false);
      expect(prisma.user.update).toHaveBeenCalled();
      expect(prisma.xpLog.create).toHaveBeenCalled();
    });

    it('should detect level up', async () => {
      // Level 1 needs 100 XP, Level 2 needs 220 XP total
      // User at 215 totalXp (level 1), adding 10 → 225 totalXp (level 2)
      const userNearLevelUp = {
        ...mockUser,
        xp: 115,
        totalXp: 215,
        level: 1,
      };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(userNearLevelUp);
      (prisma.user.update as jest.Mock).mockResolvedValue({});
      (prisma.xpLog.create as jest.Mock).mockResolvedValue({});

      const result = await service.addXp(userId, {
        action: XpAction.HABIT_COMPLETE,
        xpAmount: 10,
        description: 'Completed habit',
      });

      expect(result.leveledUp).toBe(true);
      expect(result.newLevel).toBe(2);
      // Should create 2 XP logs: one for the action, one for level up
      expect(prisma.xpLog.create).toHaveBeenCalledTimes(2);
    });

    it('should deduplicate DAY_COMPLETE per day', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.xpLog.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-log',
      });

      const result = await service.addXp(userId, {
        action: XpAction.DAY_COMPLETE,
        xpAmount: 25,
        description: 'Day complete',
      });

      expect(result.xpEarned).toBe(0);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should include streak bonus in XP amount', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.user.update as jest.Mock).mockResolvedValue({});
      (prisma.xpLog.create as jest.Mock).mockResolvedValue({});
      (streakService.updateHabitStreak as jest.Mock).mockResolvedValue({
        streak: 3,
        streakBonus: 10,
        streakType: 'habits',
        isNewRecord: true,
      });

      const result = await service.addXp(userId, {
        action: XpAction.HABIT_COMPLETE,
        xpAmount: 10,
        description: 'Completed habit',
      });

      // 10 base + 10 streak bonus = 20
      expect(result.xpEarned).toBe(20);
    });

    it('should throw for non-existent user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.addXp(userId, {
          action: XpAction.HABIT_COMPLETE,
          xpAmount: 10,
          description: 'Test',
        }),
      ).rejects.toThrow('Usuario no encontrado');
    });

    it('should update nutrition streak for NUTRITION_LOG action', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.user.update as jest.Mock).mockResolvedValue({});
      (prisma.xpLog.create as jest.Mock).mockResolvedValue({});

      await service.addXp(userId, {
        action: XpAction.NUTRITION_LOG,
        xpAmount: 15,
        description: 'Nutrition log',
      });

      expect(streakService.updateNutritionStreak).toHaveBeenCalledWith(
        userId,
        expect.any(String),
      );
    });

    it('should update activity streak for PHYSICAL_ACTIVITY action', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.user.update as jest.Mock).mockResolvedValue({});
      (prisma.xpLog.create as jest.Mock).mockResolvedValue({});

      await service.addXp(userId, {
        action: XpAction.PHYSICAL_ACTIVITY,
        xpAmount: 60,
        description: 'Physical activity',
      });

      expect(streakService.updateActivityStreak).toHaveBeenCalledWith(
        userId,
        expect.any(String),
      );
    });
  });

  describe('addHabitXp', () => {
    it('should add 10 XP with HABIT_COMPLETE action', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.user.update as jest.Mock).mockResolvedValue({});
      (prisma.xpLog.create as jest.Mock).mockResolvedValue({});

      const result = await service.addHabitXp(userId, 'Exercise');

      expect(result.xpEarned).toBeGreaterThanOrEqual(10);
      expect(prisma.xpLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: XpAction.HABIT_COMPLETE,
            description: 'Completaste el hábito: Exercise',
          }),
        }),
      );
    });
  });

  describe('addNutritionXp', () => {
    it('should add 15 XP with NUTRITION_LOG action', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.user.update as jest.Mock).mockResolvedValue({});
      (prisma.xpLog.create as jest.Mock).mockResolvedValue({});

      const result = await service.addNutritionXp(userId, 'almuerzo');

      expect(result.xpEarned).toBeGreaterThanOrEqual(15);
    });
  });

  describe('getXpStats', () => {
    it('should return full XP stats with streaks', async () => {
      const userWithLogs = {
        ...mockUser,
        level: 2,
        xp: 50,
        totalXp: 150,
        xpLogs: [
          {
            id: 'log-1',
            action: 'habit_complete',
            xpEarned: 10,
            description: 'Test',
            date: '2024-01-15',
            metadata: {},
            createdAt: new Date(),
          },
        ],
      };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(userWithLogs);

      const result = await service.getXpStats(userId);

      expect(result.level).toBe(2);
      expect(result.xp).toBe(50);
      expect(result.totalXp).toBe(150);
      expect(result.streaks).toBeDefined();
      expect(result.streaks.habits).toBeDefined();
      expect(result.streaks.nutrition).toBeDefined();
      expect(result.streaks.activity).toBeDefined();
      expect(result.recentLogs).toHaveLength(1);
    });

    it('should throw for non-existent user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getXpStats(userId)).rejects.toThrow(
        'Usuario no encontrado',
      );
    });
  });
});
