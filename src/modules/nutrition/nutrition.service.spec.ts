import { Test, TestingModule } from '@nestjs/testing';
import { NutritionService } from './nutrition.service';
import { PrismaService } from '../../config/prisma.service';
import { AICostService } from '../ai-cost/ai-cost.service';

describe('NutritionService', () => {
  let service: NutritionService;
  let prisma: PrismaService;

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
      ],
    }).compile();

    service = module.get<NutritionService>(NutritionService);
    prisma = module.get<PrismaService>(PrismaService);
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
});
