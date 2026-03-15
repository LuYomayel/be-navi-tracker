import { Test, TestingModule } from '@nestjs/testing';
import { PreferencesService } from './preferences.service';
import { PrismaService } from '../../config/prisma.service';

describe('PreferencesService', () => {
  let service: PreferencesService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockPreferences = {
    id: 'pref-1',
    userId,
    height: 175,
    currentWeight: 75,
    targetWeight: 70,
    age: 30,
    gender: 'male',
    activityLevel: 'moderate',
    fitnessGoals: ['lose_weight'],
    dailyCalorieGoal: 2000,
    proteinGoal: 120,
    carbsGoal: 200,
    fatGoal: 70,
    fiberGoal: 25,
    lastBodyAnalysisId: '',
    bmr: 0,
    tdee: 0,
    preferredUnits: 'metric',
    notifications: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreferencesService,
        {
          provide: PrismaService,
          useValue: {
            userPreferences: {
              findUnique: jest.fn(),
              upsert: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<PreferencesService>(PreferencesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getPreferences', () => {
    it('should return user preferences', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockResolvedValue(
        mockPreferences,
      );

      const result = await service.getPreferences(userId);

      expect(result).not.toBeNull();
      expect(result!.height).toBe(175);
      expect(result!.dailyCalorieGoal).toBe(2000);
      expect(prisma.userPreferences.findUnique).toHaveBeenCalledWith({
        where: { userId },
      });
    });

    it('should return null when no preferences exist', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getPreferences(userId);

      expect(result).toBeNull();
    });

    it('should throw on database error', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      await expect(service.getPreferences(userId)).rejects.toThrow(
        'Failed to get preferences',
      );
    });
  });

  describe('setPreferences', () => {
    it('should upsert preferences', async () => {
      (prisma.userPreferences.upsert as jest.Mock).mockResolvedValue(
        mockPreferences,
      );

      const data = {
        height: 175,
        currentWeight: 75,
        targetWeight: 70,
        age: 30,
        gender: 'male' as const,
        activityLevel: 'moderate' as const,
        fitnessGoal: 'lose_weight',
        finalGoals: {
          dailyCalories: 2000,
          protein: 120,
          carbs: 200,
          fat: 70,
          fiber: 25,
        },
      };

      const result = await service.setPreferences(data, userId);

      expect(result).not.toBeNull();
      expect(prisma.userPreferences.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
        }),
      );
    });
  });

  describe('updateGoals', () => {
    it('should update nutrition goals', async () => {
      (prisma.userPreferences.upsert as jest.Mock).mockResolvedValue({
        ...mockPreferences,
        dailyCalorieGoal: 2500,
      });

      const result = await service.updateGoals(
        { dailyCalorieGoal: 2500 },
        userId,
      );

      expect(result).not.toBeNull();
      expect(prisma.userPreferences.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          update: expect.objectContaining({ dailyCalorieGoal: 2500 }),
        }),
      );
    });
  });

  describe('getCurrentGoals', () => {
    it('should return current nutrition goals', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockResolvedValue(
        mockPreferences,
      );

      const result = await service.getCurrentGoals(userId);

      expect(result).not.toBeNull();
      expect(result!.dailyCalorieGoal).toBe(2000);
      expect(result!.proteinGoal).toBe(120);
    });

    it('should return null when no preferences', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getCurrentGoals(userId);

      expect(result).toBeNull();
    });

    it('should return defaults when goals are null', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockResolvedValue({
        ...mockPreferences,
        dailyCalorieGoal: null,
        proteinGoal: null,
        carbsGoal: null,
        fatGoal: null,
      });

      const result = await service.getCurrentGoals(userId);

      expect(result!.dailyCalorieGoal).toBe(2000);
      expect(result!.proteinGoal).toBe(120);
      expect(result!.carbsGoal).toBe(200);
      expect(result!.fatGoal).toBe(70);
    });
  });

  describe('getProgressData', () => {
    it('should calculate BMI and progress', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockResolvedValue(
        mockPreferences,
      );

      const result = await service.getProgressData(userId);

      expect(result).not.toBeNull();
      expect(result!.currentWeight).toBe(75);
      expect(result!.targetWeight).toBe(70);
      expect(result!.bmi).toBeCloseTo(24.5, 0);
      expect(result!.weightToGoal).toBe(5);
    });

    it('should return null when no preferences', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getProgressData(userId);

      expect(result).toBeNull();
    });

    it('should return null when missing required fields', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockResolvedValue({
        ...mockPreferences,
        currentWeight: null,
        height: null,
      });

      const result = await service.getProgressData(userId);

      expect(result).toBeNull();
    });
  });

  describe('resetPreferences', () => {
    it('should delete preferences and return true', async () => {
      (prisma.userPreferences.delete as jest.Mock).mockResolvedValue(
        mockPreferences,
      );

      const result = await service.resetPreferences(userId);

      expect(result).toBe(true);
    });

    it('should return true even when preferences do not exist', async () => {
      (prisma.userPreferences.delete as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      );

      const result = await service.resetPreferences(userId);

      expect(result).toBe(true);
    });
  });
});
