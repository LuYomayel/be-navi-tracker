import { Test, TestingModule } from '@nestjs/testing';
import { NutritionService } from './nutrition.service';
import { PrismaService } from '../../config/prisma.service';
import { AICostService } from '../ai-cost/ai-cost.service';
import { XpService } from '../xp/xp.service';
import { getLocalDateString } from '../../common/utils/date.utils';

describe('NutritionService', () => {
  let service: NutritionService;
  let prisma: PrismaService;
  let xpService: XpService;

  const userId = 'user-1';

  const mockAnalysis = {
    id: 'analysis-1',
    userId,
    date: '2024-01-15',
    mealType: 'almuerzo',
    foods: [{ name: 'Arroz', calories: 200 }],
    totalCalories: 200,
    macronutrients: { protein: 5, carbs: 40, fat: 1, fiber: 1 },
    imageUrl: null,
    aiConfidence: 0.9,
    userAdjustments: null,
    context: null,
    aiCostUsd: null,
    savedMealId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockWeightEntry = {
    id: 'weight-1',
    userId,
    date: '2024-01-15',
    weight: 75.5,
    bodyFatPercentage: 18,
    muscleMassPercentage: null,
    bodyWaterPercentage: null,
    bmi: 23.1,
    bfr: null,
    score: null,
    imageUrl: null,
    source: 'manual',
    aiConfidence: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NutritionService,
        {
          provide: PrismaService,
          useValue: {
            nutritionAnalysis: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            weightEntry: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            userPreferences: {
              findUnique: jest.fn(),
            },
            physicalActivity: {
              findMany: jest.fn(),
            },
            user: {
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: AICostService,
          useValue: {
            logFromCompletion: jest.fn(),
            calculateCost: jest.fn().mockReturnValue(0),
          },
        },
        {
          provide: XpService,
          useValue: {
            addXp: jest.fn().mockResolvedValue({}),
            addNutritionXp: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<NutritionService>(NutritionService);
    prisma = module.get<PrismaService>(PrismaService);
    xpService = module.get<XpService>(XpService);
  });

  describe('getAll', () => {
    it('should return all nutrition analyses for user', async () => {
      (prisma.nutritionAnalysis.findMany as jest.Mock).mockResolvedValue([
        mockAnalysis,
      ]);

      const result = await service.getAll(userId);

      expect(result).toHaveLength(1);
      expect(prisma.nutritionAnalysis.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        where: { userId },
      });
    });

    it('should return empty array on error', async () => {
      (prisma.nutritionAnalysis.findMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.getAll(userId);

      expect(result).toEqual([]);
    });
  });

  describe('getByDate', () => {
    it('should return analyses for a specific date', async () => {
      (prisma.nutritionAnalysis.findMany as jest.Mock).mockResolvedValue([
        mockAnalysis,
      ]);

      const result = await service.getByDate('2024-01-15', userId);

      expect(result).toHaveLength(1);
      expect(prisma.nutritionAnalysis.findMany).toHaveBeenCalledWith({
        where: { date: '2024-01-15', userId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('create', () => {
    it('should create a nutrition analysis', async () => {
      (prisma.nutritionAnalysis.create as jest.Mock).mockResolvedValue(
        mockAnalysis,
      );

      const data = {
        date: '2024-01-15',
        mealType: 'almuerzo',
        foods: [{ name: 'Arroz', calories: 200 }],
        totalCalories: 200,
        macronutrients: { protein: 5, carbs: 40, fat: 1, fiber: 1 },
      };

      const result = await service.create(data as any, userId);

      expect(result).toBeDefined();
      expect(prisma.nutritionAnalysis.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId }),
        }),
      );
    });

    it('should throw on database error', async () => {
      (prisma.nutritionAnalysis.create as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        service.create({ foods: [], macronutrients: {} } as any, userId),
      ).rejects.toThrow('Error al crear análisis nutricional');
    });

    it('should award +15 XP exactly once for the created meal', async () => {
      (prisma.nutritionAnalysis.create as jest.Mock).mockResolvedValue(
        mockAnalysis,
      );

      await service.create(
        {
          date: '2024-01-15',
          mealType: 'almuerzo',
          foods: [],
          macronutrients: {},
        } as any,
        userId,
      );

      expect(xpService.addNutritionXp).toHaveBeenCalledTimes(1);
      expect(xpService.addNutritionXp).toHaveBeenCalledWith(
        userId,
        'almuerzo',
        '2024-01-15',
      );
    });

    it('should not award XP when the creation fails', async () => {
      (prisma.nutritionAnalysis.create as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        service.create({ foods: [], macronutrients: {} } as any, userId),
      ).rejects.toThrow();

      expect(xpService.addNutritionXp).not.toHaveBeenCalled();
    });

    it('should still create the meal if awarding XP fails', async () => {
      (prisma.nutritionAnalysis.create as jest.Mock).mockResolvedValue(
        mockAnalysis,
      );
      (xpService.addNutritionXp as jest.Mock).mockRejectedValue(
        new Error('XP down'),
      );

      const result = await service.create(
        { foods: [], macronutrients: {} } as any,
        userId,
      );

      expect(result).toBeDefined();
      expect(result.id).toBe('analysis-1');
    });
  });

  describe('evaluateDailyGoalsForAllUsers', () => {
    // El cron corre a la 01:00 ART: tiene que evaluar el día que terminó (ayer).
    const yesterday = () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(Date.now() - 24 * 60 * 60 * 1000));

    it('should evaluate yesterday and not today', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1' }]);
      const check = jest
        .spyOn(service, 'checkDailyNutritionGoals')
        .mockResolvedValue({ meetsGoals: false, totals: {} });

      await service.evaluateDailyGoalsForAllUsers();

      expect(check).toHaveBeenCalledWith('u1', yesterday());
      expect(check).not.toHaveBeenCalledWith('u1', getLocalDateString());
    });

    it('should award the 40 XP bonus to each user that meets the goals', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        { id: 'u1' },
        { id: 'u2' },
        { id: 'u3' },
      ]);
      jest
        .spyOn(service, 'checkDailyNutritionGoals')
        .mockImplementation(async (uid: string) => ({
          meetsGoals: uid !== 'u2',
          totals: {},
        }));

      await service.evaluateDailyGoalsForAllUsers();

      expect(xpService.addXp).toHaveBeenCalledTimes(2);
      expect(xpService.addXp).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ xpAmount: 40 }),
        yesterday(),
      );
      expect(xpService.addXp).toHaveBeenCalledWith(
        'u3',
        expect.objectContaining({ xpAmount: 40 }),
        yesterday(),
      );
      // El bug original le daba el XP al userId literal 'system', que no existe.
      expect(xpService.addXp).not.toHaveBeenCalledWith(
        'system',
        expect.anything(),
        expect.anything(),
      );
    });

    it('should not award XP to users that do not meet the goals', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1' }]);
      jest
        .spyOn(service, 'checkDailyNutritionGoals')
        .mockResolvedValue({ meetsGoals: false, totals: {} });

      await service.evaluateDailyGoalsForAllUsers();

      expect(xpService.addXp).not.toHaveBeenCalled();
    });

    it('should return one result per user instead of only the last one', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        { id: 'u1' },
        { id: 'u2' },
      ]);
      jest
        .spyOn(service, 'checkDailyNutritionGoals')
        .mockImplementation(async (uid: string) => ({
          meetsGoals: uid === 'u1',
          totals: { calories: 100 },
        }));

      const result = await service.evaluateDailyGoalsForAllUsers();

      expect(result.date).toBe(yesterday());
      expect(result.results).toHaveLength(2);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: 'u1', meetsGoals: true }),
          expect.objectContaining({ userId: 'u2', meetsGoals: false }),
        ]),
      );
    });

    it('should keep going when one user fails', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        { id: 'u1' },
        { id: 'u2' },
      ]);
      jest
        .spyOn(service, 'checkDailyNutritionGoals')
        .mockImplementation(async (uid: string) => {
          if (uid === 'u1') throw new Error('boom');
          return { meetsGoals: true, totals: {} };
        });

      const result = await service.evaluateDailyGoalsForAllUsers();

      expect(result.results).toHaveLength(1);
      expect(xpService.addXp).toHaveBeenCalledWith(
        'u2',
        expect.objectContaining({ xpAmount: 40 }),
        yesterday(),
      );
    });
  });

  describe('delete', () => {
    it('should delete and return true', async () => {
      (prisma.nutritionAnalysis.delete as jest.Mock).mockResolvedValue(
        mockAnalysis,
      );

      const result = await service.delete('analysis-1', userId);

      expect(result).toBe(true);
      expect(prisma.nutritionAnalysis.delete).toHaveBeenCalledWith({
        where: { id: 'analysis-1', userId },
      });
    });

    it('should return false on error', async () => {
      (prisma.nutritionAnalysis.delete as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      );

      const result = await service.delete('nonexistent', userId);

      expect(result).toBe(false);
    });
  });

  // Weight Entry tests
  describe('getAllWeightEntries', () => {
    it('should return all weight entries for user', async () => {
      (prisma.weightEntry.findMany as jest.Mock).mockResolvedValue([
        mockWeightEntry,
      ]);

      const result = await service.getAllWeightEntries(userId);

      expect(result).toHaveLength(1);
      expect(result[0].weight).toBe(75.5);
    });

    it('should return empty array on error', async () => {
      (prisma.weightEntry.findMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.getAllWeightEntries(userId);

      expect(result).toEqual([]);
    });
  });

  describe('deleteWeightEntry', () => {
    it('should delete and return true', async () => {
      (prisma.weightEntry.delete as jest.Mock).mockResolvedValue(
        mockWeightEntry,
      );

      const result = await service.deleteWeightEntry('weight-1', userId);

      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      (prisma.weightEntry.delete as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      );

      const result = await service.deleteWeightEntry('nonexistent', userId);

      expect(result).toBe(false);
    });
  });

  describe('getWeightStats', () => {
    it('should calculate weight statistics for a timeframe', async () => {
      const entries = [
        { ...mockWeightEntry, weight: 80, bmi: 24, bfr: 20, createdAt: new Date('2024-01-01') },
        { ...mockWeightEntry, weight: 76, bmi: 23, bfr: 18, createdAt: new Date('2024-01-15') },
      ];
      (prisma.weightEntry.findMany as jest.Mock).mockResolvedValue(entries);

      const result = await service.getWeightStats(userId, 'month');

      expect(result).not.toBeNull();
      expect(result!.totalEntries).toBe(2);
      expect(result!.averageWeight).toBe(78);
      expect(result!.minWeight).toBe(76);
      expect(result!.maxWeight).toBe(80);
      expect(result!.trend).toBe('decreasing');
    });

    it('should return zeros when no entries', async () => {
      (prisma.weightEntry.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getWeightStats(userId, 'month');

      expect(result).not.toBeNull();
      expect(result!.totalEntries).toBe(0);
      expect(result!.trend).toBe('stable');
    });
  });

  describe('getDailyNutritionBalance', () => {
    it('should calculate daily balance correctly', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockResolvedValue({
        dailyCalorieGoal: 2000,
        proteinGoal: 120,
        carbsGoal: 200,
        fatGoal: 70,
        fiberGoal: 25,
      });
      (prisma.nutritionAnalysis.findMany as jest.Mock).mockResolvedValue([
        {
          totalCalories: 500,
          macronutrients: { protein: 30, carbs: 60, fat: 15, fiber: 5 },
        },
        {
          totalCalories: 700,
          macronutrients: { protein: 40, carbs: 80, fat: 20, fiber: 8 },
        },
      ]);
      (prisma.physicalActivity.findMany as jest.Mock).mockResolvedValue([
        { activeEnergyKcal: 300, steps: 5000, distanceKm: 3, exerciseMinutes: 45 },
      ]);

      const result = await service.getDailyNutritionBalance(
        userId,
        '2024-01-15',
      );

      expect(result.consumed.calories).toBe(1200);
      expect(result.consumed.protein).toBe(70);
      expect(result.burned.calories).toBe(300);
      expect(result.netCalories).toBe(900);
      expect(result.goals.dailyCalorieGoal).toBe(2000);
    });

    it('should throw when no preferences found', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getDailyNutritionBalance(userId, '2024-01-15'),
      ).rejects.toThrow('User preferences not found');
    });
  });

  describe('analyzeWeightManual', () => {
    it('should create a manual weight entry', async () => {
      (prisma.weightEntry.create as jest.Mock).mockResolvedValue(
        mockWeightEntry,
      );

      const result = await service.analyzeWeightManual(
        { weight: 75.5, source: 'manual' } as any,
        userId,
      );

      expect(result).not.toBeNull();
      expect(prisma.weightEntry.create).toHaveBeenCalled();
    });

    it('should return null on error', async () => {
      (prisma.weightEntry.create as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.analyzeWeightManual(
        { weight: 75.5, source: 'manual' } as any,
        userId,
      );

      expect(result).toBeNull();
    });
  });

  describe('setCompliance', () => {
    it('should mark a meal as on_diet', async () => {
      (prisma.nutritionAnalysis.findFirst as jest.Mock).mockResolvedValue(
        mockAnalysis,
      );
      (prisma.nutritionAnalysis.update as jest.Mock).mockResolvedValue({
        ...mockAnalysis,
        dietCompliance: 'on_diet',
        complianceNote: null,
      });

      const result = await service.setCompliance(
        'analysis-1',
        userId,
        'on_diet',
      );

      expect(prisma.nutritionAnalysis.findFirst).toHaveBeenCalledWith({
        where: { id: 'analysis-1', userId },
      });
      expect(prisma.nutritionAnalysis.update).toHaveBeenCalledWith({
        where: { id: 'analysis-1' },
        data: { dietCompliance: 'on_diet', complianceNote: null },
      });
      expect(result.dietCompliance).toBe('on_diet');
    });

    it('should mark a meal as off_diet with a context note', async () => {
      (prisma.nutritionAnalysis.findFirst as jest.Mock).mockResolvedValue(
        mockAnalysis,
      );
      (prisma.nutritionAnalysis.update as jest.Mock).mockResolvedValue({
        ...mockAnalysis,
        dietCompliance: 'off_diet',
        complianceNote: 'Cumple de mama',
      });

      const result = await service.setCompliance(
        'analysis-1',
        userId,
        'off_diet',
        'Cumple de mama',
      );

      expect(prisma.nutritionAnalysis.update).toHaveBeenCalledWith({
        where: { id: 'analysis-1' },
        data: { dietCompliance: 'off_diet', complianceNote: 'Cumple de mama' },
      });
      expect(result.complianceNote).toBe('Cumple de mama');
    });

    it('should clear the mark when compliance is null', async () => {
      (prisma.nutritionAnalysis.findFirst as jest.Mock).mockResolvedValue(
        mockAnalysis,
      );
      (prisma.nutritionAnalysis.update as jest.Mock).mockResolvedValue({
        ...mockAnalysis,
        dietCompliance: null,
        complianceNote: null,
      });

      const result = await service.setCompliance('analysis-1', userId, null);

      expect(prisma.nutritionAnalysis.update).toHaveBeenCalledWith({
        where: { id: 'analysis-1' },
        data: { dietCompliance: null, complianceNote: null },
      });
      expect(result.dietCompliance).toBeNull();
    });

    it('should throw when the meal does not belong to the user', async () => {
      (prisma.nutritionAnalysis.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.setCompliance('analysis-1', 'otro-user', 'on_diet'),
      ).rejects.toThrow();
      expect(prisma.nutritionAnalysis.update).not.toHaveBeenCalled();
    });

    it('should reject an invalid compliance value', async () => {
      await expect(
        service.setCompliance('analysis-1', userId, 'cheat' as any),
      ).rejects.toThrow();
    });
  });

  describe('getComplianceStats', () => {
    it('should aggregate compliance counts in a date range', async () => {
      (prisma.nutritionAnalysis.findMany as jest.Mock).mockResolvedValue([
        { ...mockAnalysis, id: 'a1', date: '2026-08-01', dietCompliance: 'on_diet' },
        { ...mockAnalysis, id: 'a2', date: '2026-08-01', dietCompliance: 'on_diet' },
        {
          ...mockAnalysis,
          id: 'a3',
          date: '2026-08-02',
          mealType: 'dinner',
          dietCompliance: 'off_diet',
          complianceNote: 'Pizza con amigos',
        },
        { ...mockAnalysis, id: 'a4', date: '2026-08-03', dietCompliance: null },
      ]);

      const stats = await service.getComplianceStats(
        userId,
        '2026-08-01',
        '2026-08-07',
      );

      expect(prisma.nutritionAnalysis.findMany).toHaveBeenCalledWith({
        where: { userId, date: { gte: '2026-08-01', lte: '2026-08-07' } },
        orderBy: { date: 'asc' },
      });
      expect(stats.total).toBe(4);
      expect(stats.onDiet).toBe(2);
      expect(stats.offDiet).toBe(1);
      expect(stats.unmarked).toBe(1);
      expect(stats.adherencePct).toBe(67); // 2 de 3 marcadas
      expect(stats.offDietMeals).toEqual([
        {
          id: 'a3',
          date: '2026-08-02',
          mealType: 'dinner',
          note: 'Pizza con amigos',
        },
      ]);
    });

    it('should return zeroed stats when there are no meals', async () => {
      (prisma.nutritionAnalysis.findMany as jest.Mock).mockResolvedValue([]);

      const stats = await service.getComplianceStats(
        userId,
        '2026-08-01',
        '2026-08-07',
      );

      expect(stats.total).toBe(0);
      expect(stats.adherencePct).toBeNull();
      expect(stats.offDietMeals).toEqual([]);
    });
  });
});
