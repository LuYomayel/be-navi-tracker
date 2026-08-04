import { Test, TestingModule } from '@nestjs/testing';
import { SavedMealsService } from './saved-meals.service';
import { PrismaService } from '../../config/prisma.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { AICostService } from '../ai-cost/ai-cost.service';

describe('SavedMealsService', () => {
  let service: SavedMealsService;
  let prisma: PrismaService;
  let nutrition: NutritionService;

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
        {
          provide: NutritionService,
          useValue: {
            create: jest.fn(),
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

    service = module.get<SavedMealsService>(SavedMealsService);
    prisma = module.get<PrismaService>(PrismaService);
    nutrition = module.get<NutritionService>(NutritionService);
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

    it('should update all editable fields (macros, kcal, type)', async () => {
      (prisma.savedMeal.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const macros = {
        protein: 8,
        carbs: 20,
        fat: 5,
        fiber: 0,
        sugar: 18,
        sodium: 60,
      };
      const foods = [{ name: 'Café con leche', quantity: '1 taza' }];

      await service.update(
        'meal-1',
        {
          name: 'Café con leche',
          mealType: 'breakfast',
          totalCalories: 150,
          macronutrients: macros,
          foods,
        },
        userId,
      );

      expect(prisma.savedMeal.updateMany).toHaveBeenCalledWith({
        where: { id: 'meal-1', userId },
        data: {
          name: 'Café con leche',
          mealType: 'breakfast',
          totalCalories: 150,
          macronutrients: macros,
          foods,
        },
      });
    });

    it('should ignore non-whitelisted fields (userId, timesUsed)', async () => {
      (prisma.savedMeal.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await service.update(
        'meal-1',
        { name: 'X', userId: 'hacker', timesUsed: 999 } as any,
        userId,
      );

      expect(prisma.savedMeal.updateMany).toHaveBeenCalledWith({
        where: { id: 'meal-1', userId },
        data: { name: 'X' },
      });
    });
  });

  describe('logAsNutrition', () => {
    it('should create a nutrition analysis from the saved meal and increment usage', async () => {
      (prisma.savedMeal.findFirst as jest.Mock).mockResolvedValue(mockMeal);
      (prisma.savedMeal.update as jest.Mock).mockResolvedValue({
        ...mockMeal,
        timesUsed: 4,
      });
      (nutrition.create as jest.Mock).mockResolvedValue({ id: 'na-1' });

      const result = await service.logAsNutrition('meal-1', userId, '2026-06-07');

      expect(nutrition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-06-07',
          mealType: mockMeal.mealType,
          foods: mockMeal.foods,
          totalCalories: mockMeal.totalCalories,
          macronutrients: mockMeal.macronutrients,
        }),
        userId,
      );
      expect(prisma.savedMeal.update).toHaveBeenCalledWith({
        where: { id: 'meal-1' },
        data: {
          timesUsed: { increment: 1 },
          lastUsedAt: expect.any(Date),
        },
      });
      expect(result).toEqual({ meal: mockMeal, analysis: { id: 'na-1' } });
    });

    it('should default to today (YYYY-MM-DD) when no date is given', async () => {
      (prisma.savedMeal.findFirst as jest.Mock).mockResolvedValue(mockMeal);
      (prisma.savedMeal.update as jest.Mock).mockResolvedValue(mockMeal);
      (nutrition.create as jest.Mock).mockResolvedValue({ id: 'na-2' });

      await service.logAsNutrition('meal-1', userId);

      const arg = (nutrition.create as jest.Mock).mock.calls[0][0];
      expect(arg.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return null and not log if meal not found (ownership)', async () => {
      (prisma.savedMeal.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.logAsNutrition('nonexistent', userId);

      expect(result).toBeNull();
      expect(nutrition.create).not.toHaveBeenCalled();
      expect(prisma.savedMeal.update).not.toHaveBeenCalled();
    });
  });

  describe('logPlate', () => {
    const proteina = {
      ...mockMeal,
      id: 'comp-1',
      name: '2 hamburguesas caseras',
      component: 'protein',
      foods: [{ name: '2 hamburguesas caseras', calories: 450 }],
      totalCalories: 450,
      macronutrients: { protein: 40, carbs: 5, fat: 28, fiber: 0 },
    };
    const carbo = {
      ...mockMeal,
      id: 'comp-2',
      name: '120g fideos caseros',
      component: 'carb',
      foods: [{ name: '120g fideos caseros', calories: 400 }],
      totalCalories: 400,
      macronutrients: { protein: 12, carbs: 80, fat: 3, fiber: 4 },
    };
    const verdura = {
      ...mockMeal,
      id: 'comp-3',
      name: 'Ensalada mixta',
      component: 'veggie',
      foods: [{ name: 'Ensalada mixta', calories: 60 }],
      totalCalories: 60,
      macronutrients: { protein: 2, carbs: 10, fat: 1, fiber: 5 },
    };

    it('should compose one nutrition analysis from multiple components', async () => {
      (prisma.savedMeal.findMany as jest.Mock).mockResolvedValue([
        proteina,
        carbo,
        verdura,
      ]);
      (nutrition.create as jest.Mock).mockResolvedValue({
        id: 'analysis-1',
        totalCalories: 910,
      });
      (prisma.savedMeal.update as jest.Mock).mockResolvedValue({});

      const result = await service.logPlate(userId, {
        componentIds: ['comp-1', 'comp-2', 'comp-3'],
        mealType: 'lunch',
        date: '2026-08-04',
      });

      expect(nutrition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-08-04',
          mealType: 'lunch',
          totalCalories: 910,
          foods: [
            { name: '2 hamburguesas caseras', calories: 450 },
            { name: '120g fideos caseros', calories: 400 },
            { name: 'Ensalada mixta', calories: 60 },
          ],
          macronutrients: { protein: 54, carbs: 95, fat: 32, fiber: 9 },
        }),
        userId,
      );
      // Incrementa el uso de CADA componente
      expect(prisma.savedMeal.update).toHaveBeenCalledTimes(3);
      expect(result!.analysis.id).toBe('analysis-1');
      expect(result!.components.map((c: any) => c.name)).toEqual([
        '2 hamburguesas caseras',
        '120g fideos caseros',
        'Ensalada mixta',
      ]);
    });

    it('should log the plate once so the XP is granted per plate, not per component', async () => {
      (prisma.savedMeal.findMany as jest.Mock).mockResolvedValue([
        proteina,
        carbo,
        verdura,
      ]);
      (nutrition.create as jest.Mock).mockResolvedValue({ id: 'analysis-1' });
      (prisma.savedMeal.update as jest.Mock).mockResolvedValue({});

      await service.logPlate(userId, {
        componentIds: ['comp-1', 'comp-2', 'comp-3'],
        mealType: 'lunch',
        date: '2026-08-04',
      });

      // El XP lo otorga NutritionService.create: un solo create = un solo +15 XP.
      expect(nutrition.create).toHaveBeenCalledTimes(1);
    });

    it('should return null when a component is missing or foreign', async () => {
      (prisma.savedMeal.findMany as jest.Mock).mockResolvedValue([proteina]);

      const result = await service.logPlate(userId, {
        componentIds: ['comp-1', 'comp-ajeno'],
        mealType: 'lunch',
      });

      expect(result).toBeNull();
      expect(nutrition.create).not.toHaveBeenCalled();
    });

    it('should return null for an empty plate', async () => {
      const result = await service.logPlate(userId, {
        componentIds: [],
        mealType: 'lunch',
      });

      expect(result).toBeNull();
    });
  });

  describe('classifyComponents', () => {
    const unclassified = [
      { ...mockMeal, id: 'm1', name: '2 hamburguesas caseras', component: null },
      { ...mockMeal, id: 'm2', name: 'Cafe con leche', component: null },
      { ...mockMeal, id: 'm3', name: 'Ensalada mixta', component: null },
    ];

    it('should classify unclassified meals with AI and apply the updates', async () => {
      (prisma.savedMeal.findMany as jest.Mock).mockResolvedValue(unclassified);
      (prisma.savedMeal.update as jest.Mock).mockResolvedValue({});
      (service as any).openai = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      m1: 'protein',
                      m2: 'drink',
                      m3: 'veggie',
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 50, completion_tokens: 20 },
            }),
          },
        },
      };

      const result = await service.classifyComponents(userId);

      expect(result.classified).toBe(3);
      expect(prisma.savedMeal.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { component: 'protein' },
      });
      expect(prisma.savedMeal.update).toHaveBeenCalledWith({
        where: { id: 'm2' },
        data: { component: 'drink' },
      });
    });

    it('should never persist invalid AI values (falls back to heuristics)', async () => {
      (prisma.savedMeal.findMany as jest.Mock).mockResolvedValue([
        unclassified[0],
      ]);
      (prisma.savedMeal.update as jest.Mock).mockResolvedValue({});
      (service as any).openai = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [
                { message: { content: JSON.stringify({ m1: 'banana' }) } },
              ],
              usage: {},
            }),
          },
        },
      };

      const result = await service.classifyComponents(userId);

      // 'banana' no es un componente válido: se descarta y la heurística
      // resuelve por nombre ("hamburguesas" → protein)
      expect(prisma.savedMeal.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { component: 'protein' },
      });
      expect(result.classified).toBe(1);
    });

    it('should fall back to keyword heuristics without OpenAI', async () => {
      (prisma.savedMeal.findMany as jest.Mock).mockResolvedValue(unclassified);
      (prisma.savedMeal.update as jest.Mock).mockResolvedValue({});
      (service as any).openai = null;

      const result = await service.classifyComponents(userId);

      expect(result.classified).toBeGreaterThanOrEqual(2);
      expect(prisma.savedMeal.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { component: 'protein' }, // "hamburguesas"
      });
      expect(prisma.savedMeal.update).toHaveBeenCalledWith({
        where: { id: 'm2' },
        data: { component: 'drink' }, // "cafe"
      });
    });

    it('should return zero when everything is already classified', async () => {
      (prisma.savedMeal.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.classifyComponents(userId);

      expect(result.total).toBe(0);
      expect(result.classified).toBe(0);
    });
  });

  describe('create with component', () => {
    it('should persist the plate component segment', async () => {
      (prisma.savedMeal.create as jest.Mock).mockResolvedValue({
        ...mockMeal,
        component: 'protein',
      });

      await service.create(
        {
          name: '2 hamburguesas caseras',
          mealType: 'lunch',
          component: 'protein',
          foods: [],
          totalCalories: 450,
          macronutrients: { protein: 40, carbs: 5, fat: 28 },
        } as any,
        userId,
      );

      expect(prisma.savedMeal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ component: 'protein', userId }),
      });
    });
  });
});
