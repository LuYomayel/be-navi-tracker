import { Test, TestingModule } from '@nestjs/testing';
import { DayScoreService } from './day-score.service';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';

describe('DayScoreService', () => {
  let service: DayScoreService;
  let prisma: PrismaService;
  let xpService: XpService;

  const userId = 'user-1';

  const mockDayScore = {
    id: 'score-1',
    userId,
    date: '2026-03-15',
    totalItems: 7,
    completedItems: 7,
    percentage: 100,
    status: 'won',
    habitsTotal: 2,
    habitsCompleted: 2,
    tasksTotal: 1,
    tasksCompleted: 1,
    nutritionLogged: true,
    exerciseLogged: true,
    reflectionLogged: true,
    hydrationLogged: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DayScoreService,
        {
          provide: PrismaService,
          useValue: {
            activity: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            task: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            nutritionAnalysis: {
              count: jest.fn().mockResolvedValue(0),
            },
            physicalActivity: {
              count: jest.fn().mockResolvedValue(0),
            },
            note: {
              count: jest.fn().mockResolvedValue(0),
            },
            hydrationLog: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
            userPreferences: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
            dayScore: {
              upsert: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
            xpLog: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
          },
        },
        {
          provide: XpService,
          useValue: {
            addXp: jest.fn().mockResolvedValue({
              newLevel: 1,
              xpEarned: 25,
              totalXpEarned: 25,
              leveledUp: false,
              nextLevelXp: 100,
              streak: 0,
              streakBonus: 0,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<DayScoreService>(DayScoreService);
    prisma = module.get<PrismaService>(PrismaService);
    xpService = module.get<XpService>(XpService);
  });

  describe('calculate', () => {
    it('should return no_data when no items exist', async () => {
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, date: '2026-03-15', ...args.create }),
      );

      const result = await service.calculate(userId, '2026-03-15');

      // 0 habits + 0 tasks + 4 boolean modules = 4 total
      expect(result.totalItems).toBe(4);
      expect(result.completedItems).toBe(0);
      expect(result.status).toBe('lost');
    });

    it('should count habits scheduled for the day', async () => {
      // Monday = index 0, 2026-03-16 is a Monday
      const monday = '2026-03-16';
      (prisma.activity.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'act-1',
          days: [true, false, false, false, false, false, false],
          completions: [{ completed: true }],
        },
        {
          id: 'act-2',
          days: [true, false, false, false, false, false, false],
          completions: [],
        },
      ]);
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, date: monday, ...args.create }),
      );

      const result = await service.calculate(userId, monday);

      expect(result.habitsTotal).toBe(2);
      expect(result.habitsCompleted).toBe(1);
    });

    it('should count tasks due for the day', async () => {
      (prisma.task.findMany as jest.Mock).mockResolvedValue([
        { id: 't1', completed: true },
        { id: 't2', completed: false },
        { id: 't3', completed: true },
      ]);
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      const result = await service.calculate(userId, '2026-03-15');

      expect(result.tasksTotal).toBe(3);
      expect(result.tasksCompleted).toBe(2);
    });

    it('should detect nutrition logged', async () => {
      (prisma.nutritionAnalysis.count as jest.Mock).mockResolvedValue(3);
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      const result = await service.calculate(userId, '2026-03-15');

      expect(result.nutritionLogged).toBe(true);
    });

    it('should detect exercise logged', async () => {
      (prisma.physicalActivity.count as jest.Mock).mockResolvedValue(1);
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      const result = await service.calculate(userId, '2026-03-15');

      expect(result.exerciseLogged).toBe(true);
    });

    it('should detect reflection logged', async () => {
      (prisma.note.count as jest.Mock).mockResolvedValue(1);
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      const result = await service.calculate(userId, '2026-03-15');

      expect(result.reflectionLogged).toBe(true);
    });

    it('should calculate won status at 100%', async () => {
      (prisma.nutritionAnalysis.count as jest.Mock).mockResolvedValue(1);
      (prisma.physicalActivity.count as jest.Mock).mockResolvedValue(1);
      (prisma.note.count as jest.Mock).mockResolvedValue(1);
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue({ glassesConsumed: 8 });
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue({ hydrationGoalGlasses: 8 });
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      const result = await service.calculate(userId, '2026-03-15');

      expect(result.percentage).toBe(100);
      expect(result.status).toBe('won');
    });

    it('should calculate partial status at 50-99%', async () => {
      (prisma.nutritionAnalysis.count as jest.Mock).mockResolvedValue(1);
      (prisma.physicalActivity.count as jest.Mock).mockResolvedValue(1);
      // note=0, hydration=0 → 2/4 = 50%
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      const result = await service.calculate(userId, '2026-03-15');

      expect(result.percentage).toBe(50);
      expect(result.status).toBe('partial');
    });

    it('should calculate lost status at <50%', async () => {
      (prisma.nutritionAnalysis.count as jest.Mock).mockResolvedValue(1);
      // 1/4 = 25%
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      const result = await service.calculate(userId, '2026-03-15');

      expect(result.percentage).toBe(25);
      expect(result.status).toBe('lost');
    });

    it('should detect hydration logged', async () => {
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue({ glassesConsumed: 10 });
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue({ hydrationGoalGlasses: 8 });
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      const result = await service.calculate(userId, '2026-03-15');

      expect(result.hydrationLogged).toBe(true);
    });

    it('should award 25 XP for won days', async () => {
      (prisma.nutritionAnalysis.count as jest.Mock).mockResolvedValue(1);
      (prisma.physicalActivity.count as jest.Mock).mockResolvedValue(1);
      (prisma.note.count as jest.Mock).mockResolvedValue(1);
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue({ glassesConsumed: 8 });
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue({ hydrationGoalGlasses: 8 });
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      await service.calculate(userId, '2026-03-15');

      expect(xpService.addXp).toHaveBeenCalledWith(userId, {
        action: 'day_won',
        xpAmount: 25,
        description: 'Dia ganado: 2026-03-15',
        metadata: { date: '2026-03-15', percentage: 100 },
      });
    });

    it('should not award XP if already exists for that day', async () => {
      (prisma.nutritionAnalysis.count as jest.Mock).mockResolvedValue(1);
      (prisma.physicalActivity.count as jest.Mock).mockResolvedValue(1);
      (prisma.note.count as jest.Mock).mockResolvedValue(1);
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue({ glassesConsumed: 8 });
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue({ hydrationGoalGlasses: 8 });
      (prisma.xpLog.findFirst as jest.Mock).mockResolvedValue({
        id: 'xp-1',
        action: 'day_won',
      });
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      await service.calculate(userId, '2026-03-15');

      expect(xpService.addXp).not.toHaveBeenCalled();
    });

    it('should not award XP for partial days below 75%', async () => {
      (prisma.nutritionAnalysis.count as jest.Mock).mockResolvedValue(1);
      (prisma.physicalActivity.count as jest.Mock).mockResolvedValue(1);
      // 2/4 = 50% → partial but <75%
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      await service.calculate(userId, '2026-03-15');

      expect(xpService.addXp).not.toHaveBeenCalled();
    });

    it('should handle string days field (JSON parse)', async () => {
      const monday = '2026-03-16';
      (prisma.activity.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'act-1',
          days: '[true,false,false,false,false,false,false]',
          completions: [{ completed: true }],
        },
      ]);
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      const result = await service.calculate(userId, monday);

      expect(result.habitsTotal).toBe(1);
      expect(result.habitsCompleted).toBe(1);
    });
  });

  describe('getOrCalculate', () => {
    it('should use cached score for past days', async () => {
      (prisma.dayScore.findUnique as jest.Mock).mockResolvedValue(mockDayScore);

      const result = await service.getOrCalculate(userId, '2026-03-15');

      expect(result).toEqual(mockDayScore);
      expect(prisma.activity.findMany).not.toHaveBeenCalled();
    });

    it('should calculate when no cache exists for past days', async () => {
      (prisma.dayScore.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.dayScore.upsert as jest.Mock).mockImplementation(
        (args) => Promise.resolve({ id: 'score-1', userId, ...args.create }),
      );

      await service.getOrCalculate(userId, '2026-03-15');

      // Should have called calculate (which calls activity.findMany)
      expect(prisma.activity.findMany).toHaveBeenCalled();
    });

    it('should use in-memory cache for today (second call skips DB queries)', async () => {
      const today = new Date().toISOString().split('T')[0];
      const mockScore = { ...mockDayScore, date: today };
      (prisma.dayScore.upsert as jest.Mock).mockResolvedValue(mockScore);

      // First call: calculates and populates in-memory cache
      const first = await service.getOrCalculate(userId, today);
      expect(first).toEqual(mockScore);
      expect(prisma.activity.findMany).toHaveBeenCalledTimes(1);

      // Second call: should return from in-memory cache, no DB queries
      const second = await service.getOrCalculate(userId, today);
      expect(second).toEqual(mockScore);
      expect(prisma.activity.findMany).toHaveBeenCalledTimes(1); // still 1
    });

    it('should bypass in-memory cache after TTL expires', async () => {
      jest.useFakeTimers();
      const today = new Date().toISOString().split('T')[0];
      const mockScore = { ...mockDayScore, date: today };
      (prisma.dayScore.upsert as jest.Mock).mockResolvedValue(mockScore);

      // First call: populate cache
      await service.getOrCalculate(userId, today);
      expect(prisma.activity.findMany).toHaveBeenCalledTimes(1);

      // Advance past 30s TTL
      jest.advanceTimersByTime(31_000);

      // Re-setup mocks after timer advance
      (prisma.dayScore.upsert as jest.Mock).mockResolvedValue(mockScore);

      // Second call: cache expired → should recalculate
      await service.getOrCalculate(userId, today);
      expect(prisma.activity.findMany).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe('getRange', () => {
    it('should return future status for future dates', async () => {
      const futureDate = '2099-12-31';
      (prisma.dayScore.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getRange(userId, futureDate, futureDate);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('future');
      expect(result[0].percentage).toBe(0);
      expect(result[0].habitsTotal).toBe(0);
      expect(result[0].nutritionLogged).toBe(false);
      expect(result[0].hydrationLogged).toBe(false);
    });

    it('should use cached scores for past dates', async () => {
      (prisma.dayScore.findMany as jest.Mock).mockResolvedValue([mockDayScore]);

      const result = await service.getRange(userId, '2026-03-15', '2026-03-15');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('won');
    });
  });

  describe('getMonthlyStats', () => {
    it('should calculate monthly statistics', async () => {
      (prisma.dayScore.findMany as jest.Mock).mockResolvedValue([
        { ...mockDayScore, status: 'won', percentage: 100 },
        { ...mockDayScore, date: '2026-03-14', status: 'partial', percentage: 67 },
        { ...mockDayScore, date: '2026-03-13', status: 'lost', percentage: 33 },
      ]);

      const result = await service.getMonthlyStats(userId, '2026-03');

      expect(result.month).toBe('2026-03');
      expect(result.totalDays).toBe(3);
      expect(result.won).toBe(1);
      expect(result.partial).toBe(1);
      expect(result.lost).toBe(1);
      expect(result.avgPercentage).toBe(67);
    });

    it('should return zero stats for empty month', async () => {
      (prisma.dayScore.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getMonthlyStats(userId, '2026-03');

      expect(result.totalDays).toBe(0);
      expect(result.won).toBe(0);
      expect(result.avgPercentage).toBe(0);
      expect(result.bestDay).toBeNull();
      expect(result.worstDay).toBeNull();
    });

    it('should find best and worst days', async () => {
      const day1 = { ...mockDayScore, date: '2026-03-15', percentage: 100 };
      const day2 = { ...mockDayScore, date: '2026-03-14', percentage: 33 };
      (prisma.dayScore.findMany as jest.Mock).mockResolvedValue([day1, day2]);

      const result = await service.getMonthlyStats(userId, '2026-03');

      expect(result.bestDay.percentage).toBe(100);
      expect(result.worstDay.percentage).toBe(33);
    });
  });

  describe('getWinStreak', () => {
    it('should calculate current streak of consecutive won days', async () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

      (prisma.dayScore.findMany as jest.Mock).mockResolvedValue([
        { date: today, status: 'won' },
        { date: yesterday, status: 'won' },
      ]);

      const result = await service.getWinStreak(userId);

      expect(result.currentStreak).toBe(2);
      expect(result.bestStreak).toBe(2);
    });

    it('should return 0 streak when no won days', async () => {
      (prisma.dayScore.findMany as jest.Mock).mockResolvedValue([
        { date: '2026-03-15', status: 'lost' },
      ]);

      const result = await service.getWinStreak(userId);

      expect(result.currentStreak).toBe(0);
      expect(result.bestStreak).toBe(0);
    });

    it('should break streak on non-consecutive dates', async () => {
      const today = new Date().toISOString().split('T')[0];
      // Skip a day
      const twoDaysAgo = new Date(Date.now() - 172800000).toISOString().split('T')[0];

      (prisma.dayScore.findMany as jest.Mock).mockResolvedValue([
        { date: today, status: 'won' },
        { date: twoDaysAgo, status: 'won' },
      ]);

      const result = await service.getWinStreak(userId);

      expect(result.currentStreak).toBe(1);
    });

    it('should return lastWonDate', async () => {
      const today = new Date().toISOString().split('T')[0];
      (prisma.dayScore.findMany as jest.Mock).mockResolvedValue([
        { date: today, status: 'won' },
      ]);

      const result = await service.getWinStreak(userId);

      expect(result.lastWonDate).toBe(today);
    });
  });
});
