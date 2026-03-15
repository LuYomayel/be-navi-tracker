import { Test, TestingModule } from '@nestjs/testing';
import { SavedMealsService } from './saved-meals.service';
import { PrismaService } from '../../config/prisma.service';

describe('SavedMealsService', () => {
  let service: SavedMealsService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockMeal = {
    id: 'meal-1',
    userId,
    name: 'Pollo con arroz',
    description: 'Almuerzo típico',
    mealType: 'almuerzo',
    foods: [{ name: 'Pollo', calories: 300 }, { name: 'Arroz', calories: 200 }],
    totalCalories: 500,
    macronutrients: { protein: 40, carbs: 60, fat: 10, fiber: 2 },
    timesUsed: 3,
    lastUsedAt: new Date('2024-01-15'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SavedMealsService,
        {
          provide: PrismaService,
          useValue: {
            savedMeal: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<SavedMealsService>(SavedMealsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getAll', () => {
    it('should return all saved meals ordered by lastUsedAt', async () => {
      (prisma.savedMeal.findMany as jest.Mock).mockResolvedValue([mockMeal]);

      const result = await service.getAll(userId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pollo con arroz');
      expect(prisma.savedMeal.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { lastUsedAt: 'desc' },
      });
    });
  });

  describe('create', () => {
    it('should create a saved meal with userId', async () => {
      (prisma.savedMeal.create as jest.Mock).mockResolvedValue(mockMeal);

      const data = {
        name: 'Pollo con arroz',
        mealType: 'almuerzo',
        foods: [{ name: 'Pollo', calories: 300 }],
        totalCalories: 500,
        macronutrients: { protein: 40, carbs: 60, fat: 10, fiber: 2 },
      };

      const result = await service.create(data, userId);

      expect(result.name).toBe('Pollo con arroz');
      expect(prisma.savedMeal.create).toHaveBeenCalledWith({
        data: { ...data, userId },
      });
    });
  });

  describe('use', () => {
    it('should increment timesUsed and update lastUsedAt', async () => {
      (prisma.savedMeal.findFirst as jest.Mock).mockResolvedValue(mockMeal);
      (prisma.savedMeal.update as jest.Mock).mockResolvedValue({
        ...mockMeal,
        timesUsed: 4,
      });

      const result = await service.use('meal-1', userId);

      expect(result).not.toBeNull();
      expect(prisma.savedMeal.update).toHaveBeenCalledWith({
        where: { id: 'meal-1' },
        data: {
          timesUsed: { increment: 1 },
          lastUsedAt: expect.any(Date),
        },
      });
    });

    it('should return null if meal not found', async () => {
      (prisma.savedMeal.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.use('nonexistent', userId);

      expect(result).toBeNull();
      expect(prisma.savedMeal.update).not.toHaveBeenCalled();
    });

    it('should not allow using another user meal', async () => {
      (prisma.savedMeal.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.use('meal-1', 'other-user');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete meal with ownership check', async () => {
      (prisma.savedMeal.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await service.delete('meal-1', userId);

      expect(prisma.savedMeal.deleteMany).toHaveBeenCalledWith({
        where: { id: 'meal-1', userId },
      });
    });
  });

  describe('update', () => {
    it('should update meal name with ownership check', async () => {
      (prisma.savedMeal.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await service.update('meal-1', { name: 'New name' }, userId);

      expect(prisma.savedMeal.updateMany).toHaveBeenCalledWith({
        where: { id: 'meal-1', userId },
        data: { name: 'New name' },
      });
    });
  });
});
