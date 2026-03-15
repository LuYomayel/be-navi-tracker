import { Test, TestingModule } from '@nestjs/testing';
import { StreakService } from './streak.service';
import { PrismaService } from '../../config/prisma.service';

describe('StreakService', () => {
  let service: StreakService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockStreakType = {
    id: 'streak-type-1',
    code: 'habits',
    name: 'Racha de Hábitos',
    bonusMultiplier: 10,
  };

  const mockUserStreak = {
    id: 'user-streak-1',
    userId,
    streakTypeId: 'streak-type-1',
    count: 0,
    lastDate: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreakService,
        {
          provide: PrismaService,
          useValue: {
            activity: {
              findMany: jest.fn(),
            },
            nutritionAnalysis: {
              count: jest.fn(),
            },
            physicalActivity: {
              count: jest.fn(),
            },
            streakType: {
              upsert: jest.fn().mockResolvedValue(mockStreakType),
            },
            userStreak: {
              upsert: jest.fn().mockResolvedValue(mockUserStreak),
              update: jest.fn(),
              findMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<StreakService>(StreakService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('checkDailyHabitsCompletion', () => {
    it('should return false when no activities exist', async () => {
      (prisma.activity.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.checkDailyHabitsCompletion(
        userId,
        '2024-01-15',
      );

      expect(result).toBe(false);
    });

    it('should return true when all scheduled habits are completed', async () => {
      // 2024-01-16 is Tuesday (getDay()=2, dayIndex=1) — days[1]=true
      const activities = [
        {
          id: 'a1',
          days: [true, true, true, true, true, false, false],
          completions: [{ completed: true }],
        },
      ];
      (prisma.activity.findMany as jest.Mock).mockResolvedValue(activities);

      const result = await service.checkDailyHabitsCompletion(
        userId,
        '2024-01-16',
      );

      expect(result).toBe(true);
    });

    it('should return false when not all scheduled habits are completed', async () => {
      const activities = [
        {
          id: 'a1',
          days: [true, true, true, true, true, false, false],
          completions: [{ completed: true }],
        },
        {
          id: 'a2',
          days: [true, true, true, true, true, false, false],
          completions: [],
        },
      ];
      (prisma.activity.findMany as jest.Mock).mockResolvedValue(activities);

      const result = await service.checkDailyHabitsCompletion(
        userId,
        '2024-01-16',
      );

      expect(result).toBe(false);
    });

    it('should ignore activities not scheduled for the day', async () => {
      // 2024-01-16 is Tuesday (dayIndex=1), activity only on Saturday (index 5)
      const activities = [
        {
          id: 'a1',
          days: [false, false, false, false, false, true, false],
          completions: [],
        },
      ];
      (prisma.activity.findMany as jest.Mock).mockResolvedValue(activities);

      const result = await service.checkDailyHabitsCompletion(
        userId,
        '2024-01-16',
      );

      // No scheduled activities for Tuesday = false
      expect(result).toBe(false);
    });
  });

  describe('checkDailyNutritionCompletion', () => {
    it('should return true when 3+ meals logged', async () => {
      (prisma.nutritionAnalysis.count as jest.Mock).mockResolvedValue(3);

      const result = await service.checkDailyNutritionCompletion(
        userId,
        '2024-01-15',
      );

      expect(result).toBe(true);
    });

    it('should return false when less than 3 meals', async () => {
      (prisma.nutritionAnalysis.count as jest.Mock).mockResolvedValue(2);

      const result = await service.checkDailyNutritionCompletion(
        userId,
        '2024-01-15',
      );

      expect(result).toBe(false);
    });
  });

  describe('checkDailyActivityCompletion', () => {
    it('should return true when 1+ activity logged', async () => {
      (prisma.physicalActivity.count as jest.Mock).mockResolvedValue(1);

      const result = await service.checkDailyActivityCompletion(
        userId,
        '2024-01-15',
      );

      expect(result).toBe(true);
    });

    it('should return false when no activity logged', async () => {
      (prisma.physicalActivity.count as jest.Mock).mockResolvedValue(0);

      const result = await service.checkDailyActivityCompletion(
        userId,
        '2024-01-15',
      );

      expect(result).toBe(false);
    });
  });

  describe('updateHabitStreak', () => {
    it('should reset streak when habits not completed', async () => {
      (prisma.activity.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.updateHabitStreak(userId, '2024-01-15');

      expect(result.streak).toBe(0);
      expect(result.streakBonus).toBe(0);
      expect(result.streakType).toBe('habits');
    });

    it('should start streak at 1 for first completion', async () => {
      // 2024-01-16 is Tuesday (weekday, dayIndex=1)
      const activities = [
        {
          id: 'a1',
          days: [true, true, true, true, true, false, false],
          completions: [{ completed: true }],
        },
      ];
      (prisma.activity.findMany as jest.Mock).mockResolvedValue(activities);
      (prisma.userStreak.update as jest.Mock).mockResolvedValue({
        ...mockUserStreak,
        count: 1,
        lastDate: '2024-01-16',
      });

      const result = await service.updateHabitStreak(userId, '2024-01-16');

      expect(result.streak).toBe(1);
      expect(result.streakBonus).toBe(0);
    });

    it('should increment streak for consecutive day', async () => {
      // 2024-01-17 is Wednesday, previous was Tuesday 2024-01-16
      const streakWithHistory = {
        ...mockUserStreak,
        count: 2,
        lastDate: '2024-01-16',
      };
      (prisma.userStreak.upsert as jest.Mock).mockResolvedValue(
        streakWithHistory,
      );
      const activities = [
        {
          id: 'a1',
          days: [true, true, true, true, true, false, false],
          completions: [{ completed: true }],
        },
      ];
      (prisma.activity.findMany as jest.Mock).mockResolvedValue(activities);
      (prisma.userStreak.update as jest.Mock).mockResolvedValue({
        ...streakWithHistory,
        count: 3,
        lastDate: '2024-01-17',
      });

      const result = await service.updateHabitStreak(userId, '2024-01-17');

      expect(result.streak).toBe(3);
      expect(result.streakBonus).toBeGreaterThan(0);
    });

    it('should maintain streak for same day', async () => {
      // 2024-01-16 is Tuesday
      const streakSameDay = {
        ...mockUserStreak,
        count: 5,
        lastDate: '2024-01-16',
      };
      (prisma.userStreak.upsert as jest.Mock).mockResolvedValue(streakSameDay);
      const activities = [
        {
          id: 'a1',
          days: [true, true, true, true, true, false, false],
          completions: [{ completed: true }],
        },
      ];
      (prisma.activity.findMany as jest.Mock).mockResolvedValue(activities);
      (prisma.userStreak.update as jest.Mock).mockResolvedValue(streakSameDay);

      const result = await service.updateHabitStreak(userId, '2024-01-16');

      expect(result.streak).toBe(5);
    });
  });

  describe('getAllStreaks', () => {
    it('should return all three streak categories', async () => {
      (prisma.userStreak.findMany as jest.Mock).mockResolvedValue([
        {
          count: 5,
          lastDate: '2024-01-15',
          streakType: { code: 'habits' },
        },
        {
          count: 3,
          lastDate: '2024-01-15',
          streakType: { code: 'nutrition' },
        },
        {
          count: 1,
          lastDate: '2024-01-14',
          streakType: { code: 'activity' },
        },
      ]);

      const result = await service.getAllStreaks(userId);

      expect(result.habits.streak).toBe(5);
      expect(result.nutrition.streak).toBe(3);
      expect(result.activity.streak).toBe(1);
    });

    it('should return zeros for missing streak types', async () => {
      (prisma.userStreak.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getAllStreaks(userId);

      expect(result.habits).toEqual({ streak: 0, lastDate: null });
      expect(result.nutrition).toEqual({ streak: 0, lastDate: null });
      expect(result.activity).toEqual({ streak: 0, lastDate: null });
    });
  });

  describe('checkEndOfDayStreaks', () => {
    it('should reset streaks for incomplete categories', async () => {
      // No nutrition, no activity, no habits completed
      (prisma.nutritionAnalysis.count as jest.Mock).mockResolvedValue(0);
      (prisma.physicalActivity.count as jest.Mock).mockResolvedValue(0);
      (prisma.activity.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.userStreak.update as jest.Mock).mockResolvedValue({});

      const result = await service.checkEndOfDayStreaks(userId, '2024-01-15');

      expect(result.nutritionCompleted).toBe(false);
      expect(result.physicalActivityCompleted).toBe(false);
      expect(result.habitsCompleted).toBe(false);
    });
  });
});
