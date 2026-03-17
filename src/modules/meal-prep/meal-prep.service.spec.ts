import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MealPrepService } from './meal-prep.service';
import { PrismaService } from '../../config/prisma.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { SavedMealsService } from '../saved-meals/saved-meals.service';
import { AICostService } from '../ai-cost/ai-cost.service';
import { PreferencesService } from '../preferences/preferences.service';
import { MealPrepWeek } from './dto';

describe('MealPrepService', () => {
  let service: MealPrepService;
  let prisma: PrismaService;
  let nutritionService: NutritionService;

  const userId = 'user-1';

  // ─── Mock Data ──────────────────────────────────────────────

  const mockSlot = {
    name: 'Avena con frutas',
    foods: [
      { name: 'Avena', quantity: '60g', calories: 220, confidence: 0.85, macronutrients: { protein: 8, carbs: 35, fat: 5, fiber: 4 }, category: 'cereal' },
      { name: 'Banana', quantity: '1 unidad', calories: 90, confidence: 0.9, macronutrients: { protein: 1, carbs: 22, fat: 0, fiber: 2 }, category: 'fruta' },
    ],
    totalCalories: 310,
    macronutrients: { protein: 9, carbs: 57, fat: 5, fiber: 6 },
    notes: null,
    savedMealId: null,
    eatenAt: null,
    nutritionAnalysisId: null,
    isFixed: false,
  };

  const mockEmptySlot = {
    name: 'Placeholder',
    foods: [],
    totalCalories: 0,
    macronutrients: { protein: 0, carbs: 0, fat: 0, fiber: 0 },
  };

  const buildMockWeek = (): MealPrepWeek => ({
    days: {
      monday: { slots: { breakfast: { ...mockSlot }, lunch: { ...mockEmptySlot, name: 'Pollo con arroz', totalCalories: 450, macronutrients: { protein: 35, carbs: 40, fat: 12, fiber: 3 } }, snack: { ...mockEmptySlot, name: 'Yogur', totalCalories: 150, macronutrients: { protein: 10, carbs: 15, fat: 5, fiber: 0 } }, dinner: { ...mockEmptySlot, name: 'Ensalada', totalCalories: 350, macronutrients: { protein: 20, carbs: 25, fat: 10, fiber: 8 } } } },
      tuesday: { slots: { breakfast: { ...mockSlot }, lunch: { ...mockEmptySlot }, snack: { ...mockEmptySlot }, dinner: { ...mockEmptySlot } } },
      wednesday: { slots: { breakfast: { ...mockSlot }, lunch: { ...mockEmptySlot }, snack: { ...mockEmptySlot }, dinner: { ...mockEmptySlot } } },
      thursday: { slots: { breakfast: { ...mockSlot }, lunch: { ...mockEmptySlot }, snack: { ...mockEmptySlot }, dinner: { ...mockEmptySlot } } },
      friday: { slots: { breakfast: { ...mockSlot }, lunch: { ...mockEmptySlot }, snack: { ...mockEmptySlot }, dinner: { ...mockEmptySlot } } },
      saturday: { slots: { breakfast: { ...mockSlot }, lunch: { ...mockEmptySlot }, snack: { ...mockEmptySlot }, dinner: { ...mockEmptySlot } } },
      sunday: { slots: { breakfast: { ...mockSlot }, lunch: { ...mockEmptySlot }, snack: { ...mockEmptySlot }, dinner: { ...mockEmptySlot } } },
    },
  });

  const mockNutritionistPlan = {
    id: 'plan-1',
    userId,
    name: 'Plan Marzo 2026',
    rawText: 'raw content...',
    parsedPlan: {
      days: { monday: { breakfast: { name: 'Avena', foods: ['60g avena', '1 banana'], estimatedCalories: 300 } } },
      generalNotes: 'Evitar azúcar',
      restrictions: ['sin lactosa'],
      targetCalories: 2000,
      targetMacros: { protein: 120, carbs: 200, fat: 70, fiber: 30 },
    },
    weeklyNotes: 'Evitar azúcar',
    pdfFilename: 'plan.pdf',
    isActive: true,
    aiConfidence: 0.85,
    aiCostUsd: 0.02,
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
  };

  const mockMealPrep = {
    id: 'prep-1',
    userId,
    nutritionistPlanId: 'plan-1',
    weekStartDate: '2026-03-16',
    weekEndDate: '2026-03-22',
    name: 'Semana del 16 Mar',
    days: buildMockWeek(),
    dailyTotals: {},
    weeklyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
    userContext: null,
    status: 'active',
    aiCostUsd: null,
    createdAt: new Date('2026-03-15'),
    updatedAt: new Date('2026-03-15'),
  };

  // ─── Setup ──────────────────────────────────────────────────

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MealPrepService,
        {
          provide: PrismaService,
          useValue: {
            nutritionistPlan: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
            },
            mealPrep: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
            },
            userPreferences: {
              findFirst: jest.fn(),
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
          provide: SavedMealsService,
          useValue: {
            getAll: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: AICostService,
          useValue: {
            logFromCompletion: jest.fn(),
          },
        },
        {
          provide: PreferencesService,
          useValue: {
            updateGoals: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<MealPrepService>(MealPrepService);
    prisma = module.get<PrismaService>(PrismaService);
    nutritionService = module.get<NutritionService>(NutritionService);
  });

  // ═══════════════════════════════════════════════════════════
  // NUTRITIONIST PLANS
  // ═══════════════════════════════════════════════════════════

  describe('getAllNutritionistPlans', () => {
    it('should return all plans ordered by createdAt desc', async () => {
      (prisma.nutritionistPlan.findMany as jest.Mock).mockResolvedValue([mockNutritionistPlan]);

      const result = await service.getAllNutritionistPlans(userId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Plan Marzo 2026');
      expect(prisma.nutritionistPlan.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array if no plans', async () => {
      (prisma.nutritionistPlan.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getAllNutritionistPlans(userId);

      expect(result).toHaveLength(0);
    });
  });

  describe('getActiveNutritionistPlan', () => {
    it('should return the active plan', async () => {
      (prisma.nutritionistPlan.findFirst as jest.Mock).mockResolvedValue(mockNutritionistPlan);

      const result = await service.getActiveNutritionistPlan(userId);

      expect(result).not.toBeNull();
      expect(result!.isActive).toBe(true);
      expect(prisma.nutritionistPlan.findFirst).toHaveBeenCalledWith({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return null if no active plan', async () => {
      (prisma.nutritionistPlan.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getActiveNutritionistPlan(userId);

      expect(result).toBeNull();
    });
  });

  describe('importNutritionistPlan', () => {
    it('should throw BadRequestException if no images provided', async () => {
      await expect(
        service.importNutritionistPlan({ images: [], name: 'Test', pdfFilename: 'test.pdf' }, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if OpenAI not configured', async () => {
      // OpenAI is null by default in tests (no OPENAI_API_KEY)
      await expect(
        service.importNutritionistPlan(
          { images: ['base64data'], name: 'Test', pdfFilename: 'test.pdf' },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateNutritionistPlan', () => {
    it('should update plan name', async () => {
      (prisma.nutritionistPlan.findFirst as jest.Mock).mockResolvedValue(mockNutritionistPlan);
      (prisma.nutritionistPlan.update as jest.Mock).mockResolvedValue({
        ...mockNutritionistPlan,
        name: 'Nuevo nombre',
      });

      const result = await service.updateNutritionistPlan(
        'plan-1',
        { name: 'Nuevo nombre' },
        userId,
      );

      expect(result.name).toBe('Nuevo nombre');
      expect(prisma.nutritionistPlan.update).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
        data: { name: 'Nuevo nombre' },
      });
    });

    it('should deactivate other plans when activating one', async () => {
      (prisma.nutritionistPlan.findFirst as jest.Mock).mockResolvedValue(mockNutritionistPlan);
      (prisma.nutritionistPlan.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.nutritionistPlan.update as jest.Mock).mockResolvedValue({
        ...mockNutritionistPlan,
        isActive: true,
      });

      await service.updateNutritionistPlan('plan-1', { isActive: true }, userId);

      expect(prisma.nutritionistPlan.updateMany).toHaveBeenCalledWith({
        where: { userId, isActive: true, id: { not: 'plan-1' } },
        data: { isActive: false },
      });
    });

    it('should throw NotFoundException if plan not found', async () => {
      (prisma.nutritionistPlan.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateNutritionistPlan('nonexistent', { name: 'x' }, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not allow updating another user plan', async () => {
      (prisma.nutritionistPlan.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateNutritionistPlan('plan-1', { name: 'x' }, 'other-user'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteNutritionistPlan', () => {
    it('should delete the plan', async () => {
      (prisma.nutritionistPlan.findFirst as jest.Mock).mockResolvedValue(mockNutritionistPlan);
      (prisma.nutritionistPlan.delete as jest.Mock).mockResolvedValue(mockNutritionistPlan);

      const result = await service.deleteNutritionistPlan('plan-1', userId);

      expect(result).toBe(true);
      expect(prisma.nutritionistPlan.delete).toHaveBeenCalledWith({ where: { id: 'plan-1' } });
    });

    it('should throw NotFoundException if plan not found', async () => {
      (prisma.nutritionistPlan.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.deleteNutritionistPlan('nonexistent', userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // MEAL PREPS - CRUD
  // ═══════════════════════════════════════════════════════════

  describe('getAllMealPreps', () => {
    it('should return all meal preps ordered by createdAt desc', async () => {
      (prisma.mealPrep.findMany as jest.Mock).mockResolvedValue([mockMealPrep]);

      const result = await service.getAllMealPreps(userId);

      expect(result).toHaveLength(1);
      expect(prisma.mealPrep.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getActiveMealPrep', () => {
    it('should return the active meal prep for current week', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(mockMealPrep);

      const result = await service.getActiveMealPrep(userId);

      expect(result).not.toBeNull();
      expect(prisma.mealPrep.findFirst).toHaveBeenCalledWith({
        where: {
          userId,
          status: 'active',
          weekStartDate: { lte: expect.any(String) },
          weekEndDate: { gte: expect.any(String) },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return null if no active prep for current week', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getActiveMealPrep(userId);

      expect(result).toBeNull();
    });
  });

  describe('getMealPrepById', () => {
    it('should return meal prep by id with ownership check', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(mockMealPrep);

      const result = await service.getMealPrepById('prep-1', userId);

      expect(result).not.toBeNull();
      expect(prisma.mealPrep.findFirst).toHaveBeenCalledWith({
        where: { id: 'prep-1', userId },
      });
    });

    it('should return null for other user', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getMealPrepById('prep-1', 'other-user');

      expect(result).toBeNull();
    });
  });

  describe('createMealPrep', () => {
    it('should create a meal prep and compute totals', async () => {
      const week = buildMockWeek();
      (prisma.mealPrep.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prisma.mealPrep.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({
        id: 'prep-new',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.createMealPrep(
        { weekStartDate: '2026-03-16', days: week },
        userId,
      );

      expect(result.userId).toBe(userId);
      expect(result.weekStartDate).toBe('2026-03-16');
      expect(result.weekEndDate).toBe('2026-03-22');
      expect(prisma.mealPrep.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          weekStartDate: '2026-03-16',
          weekEndDate: '2026-03-22',
          status: 'active',
        }),
      });
    });

    it('should archive existing active prep for the same week', async () => {
      const week = buildMockWeek();
      (prisma.mealPrep.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.mealPrep.create as jest.Mock).mockResolvedValue({ id: 'prep-new', ...mockMealPrep });

      await service.createMealPrep({ weekStartDate: '2026-03-16', days: week }, userId);

      expect(prisma.mealPrep.updateMany).toHaveBeenCalledWith({
        where: { userId, status: 'active', weekStartDate: '2026-03-16' },
        data: { status: 'archived' },
      });
    });

    it('should generate auto name from date', async () => {
      const week = buildMockWeek();
      (prisma.mealPrep.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prisma.mealPrep.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({
        id: 'prep-new',
        ...data,
      }));

      await service.createMealPrep({ weekStartDate: '2026-03-16', days: week }, userId);

      expect(prisma.mealPrep.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Semana del 16 Mar',
        }),
      });
    });

    it('should use custom name if provided', async () => {
      const week = buildMockWeek();
      (prisma.mealPrep.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prisma.mealPrep.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({
        id: 'prep-new',
        ...data,
      }));

      await service.createMealPrep(
        { weekStartDate: '2026-03-16', days: week, name: 'Mi prep custom' },
        userId,
      );

      expect(prisma.mealPrep.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Mi prep custom',
        }),
      });
    });

    it('should compute daily totals correctly', async () => {
      const week = buildMockWeek();
      (prisma.mealPrep.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prisma.mealPrep.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({
        id: 'prep-new',
        ...data,
      }));

      const result = await service.createMealPrep({ weekStartDate: '2026-03-16', days: week }, userId);

      // Monday: breakfast(310) + lunch(450) + snack(150) + dinner(350) = 1260
      const dailyTotals = JSON.parse(JSON.stringify(result.dailyTotals));
      expect(dailyTotals.monday.calories).toBe(1260);
      expect(dailyTotals.monday.protein).toBe(9 + 35 + 10 + 20); // 74
    });
  });

  describe('updateMealPrep', () => {
    it('should update meal prep name', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(mockMealPrep);
      (prisma.mealPrep.update as jest.Mock).mockResolvedValue({
        ...mockMealPrep,
        name: 'Nuevo nombre',
      });

      const result = await service.updateMealPrep(
        'prep-1',
        { name: 'Nuevo nombre' },
        userId,
      );

      expect(result.name).toBe('Nuevo nombre');
    });

    it('should update meal prep status to archived', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(mockMealPrep);
      (prisma.mealPrep.update as jest.Mock).mockResolvedValue({
        ...mockMealPrep,
        status: 'archived',
      });

      const result = await service.updateMealPrep(
        'prep-1',
        { status: 'archived' },
        userId,
      );

      expect(result.status).toBe('archived');
    });

    it('should recompute totals when days are updated', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(mockMealPrep);
      (prisma.mealPrep.update as jest.Mock).mockImplementation(({ data }) => Promise.resolve({
        ...mockMealPrep,
        ...data,
      }));

      const newDays = buildMockWeek();
      await service.updateMealPrep('prep-1', { days: newDays }, userId);

      expect(prisma.mealPrep.update).toHaveBeenCalledWith({
        where: { id: 'prep-1' },
        data: expect.objectContaining({
          dailyTotals: expect.any(Object),
          weeklyTotals: expect.any(Object),
        }),
      });
    });

    it('should throw NotFoundException if meal prep not found', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateMealPrep('nonexistent', { name: 'x' }, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateSlot', () => {
    it('should update a specific slot in the meal prep', async () => {
      const existingPrep = { ...mockMealPrep, days: buildMockWeek() };
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(existingPrep);
      (prisma.mealPrep.update as jest.Mock).mockImplementation(({ data }) => Promise.resolve({
        ...existingPrep,
        ...data,
      }));

      const result = await service.updateSlot(
        'prep-1',
        {
          day: 'monday',
          mealType: 'breakfast',
          slot: { name: 'Tostadas con palta', totalCalories: 280 },
        },
        userId,
      );

      expect(prisma.mealPrep.update).toHaveBeenCalledWith({
        where: { id: 'prep-1' },
        data: expect.objectContaining({
          days: expect.any(Object),
          dailyTotals: expect.any(Object),
          weeklyTotals: expect.any(Object),
        }),
      });
    });

    it('should throw NotFoundException if meal prep not found', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateSlot('nonexistent', { day: 'monday', mealType: 'breakfast', slot: {} }, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should auto-initialize missing day when updating slot', async () => {
      const existingPrep = { ...mockMealPrep, days: {} };
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(existingPrep);
      (prisma.mealPrep.update as jest.Mock).mockImplementation(({ data }) => Promise.resolve({
        ...existingPrep,
        ...data,
      }));

      await service.updateSlot('prep-1', { day: 'monday', mealType: 'breakfast', slot: { name: 'Test' } }, userId);

      expect(prisma.mealPrep.update).toHaveBeenCalledWith({
        where: { id: 'prep-1' },
        data: expect.objectContaining({
          days: expect.objectContaining({
            monday: expect.objectContaining({
              slots: expect.objectContaining({
                breakfast: expect.objectContaining({ name: 'Test' }),
              }),
            }),
          }),
        }),
      });
    });
  });

  describe('markSlotEaten', () => {
    it('should mark a slot as eaten and create NutritionAnalysis', async () => {
      const existingPrep = { ...mockMealPrep, days: buildMockWeek().days };
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(existingPrep);
      (nutritionService.create as jest.Mock).mockResolvedValue({
        id: 'nutr-1',
        date: '2026-03-16',
      });
      (prisma.mealPrep.update as jest.Mock).mockImplementation(({ data }) => Promise.resolve({
        ...existingPrep,
        ...data,
      }));

      const result = await service.markSlotEaten(
        'prep-1',
        { day: 'monday', mealType: 'breakfast', date: '2026-03-16' },
        userId,
      );

      expect(result.nutritionAnalysis.id).toBe('nutr-1');
      expect(nutritionService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-03-16',
          mealType: 'breakfast',
          totalCalories: 310,
          context: 'Meal prep: Avena con frutas',
        }),
        userId,
      );
    });

    it('should throw BadRequestException if slot already eaten', async () => {
      const week = buildMockWeek();
      week.days.monday.slots.breakfast = {
        ...mockSlot,
        eatenAt: '2026-03-16T12:00:00.000Z',
      } as any;
      const existingPrep = { ...mockMealPrep, days: week.days };
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(existingPrep);

      await expect(
        service.markSlotEaten('prep-1', { day: 'monday', mealType: 'breakfast', date: '2026-03-16' }, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if meal prep not found', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.markSlotEaten('nonexistent', { day: 'monday', mealType: 'breakfast', date: '2026-03-16' }, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if no slot exists for the day/mealType', async () => {
      const week = buildMockWeek();
      week.days.monday.slots.breakfast = null as any;
      const existingPrep = { ...mockMealPrep, days: week.days };
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(existingPrep);

      await expect(
        service.markSlotEaten('prep-1', { day: 'monday', mealType: 'breakfast', date: '2026-03-16' }, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update the slot with eatenAt and nutritionAnalysisId', async () => {
      const existingPrep = { ...mockMealPrep, days: buildMockWeek().days };
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(existingPrep);
      (nutritionService.create as jest.Mock).mockResolvedValue({
        id: 'nutr-1',
        date: '2026-03-16',
      });
      (prisma.mealPrep.update as jest.Mock).mockImplementation(({ data }) => {
        const updatedDays = data.days as any;
        return Promise.resolve({ ...existingPrep, days: updatedDays });
      });

      await service.markSlotEaten(
        'prep-1',
        { day: 'monday', mealType: 'breakfast', date: '2026-03-16' },
        userId,
      );

      expect(prisma.mealPrep.update).toHaveBeenCalledWith({
        where: { id: 'prep-1' },
        data: expect.objectContaining({
          days: expect.any(Object),
          updatedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('deleteMealPrep', () => {
    it('should delete the meal prep', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(mockMealPrep);
      (prisma.mealPrep.delete as jest.Mock).mockResolvedValue(mockMealPrep);

      const result = await service.deleteMealPrep('prep-1', userId);

      expect(result).toBe(true);
      expect(prisma.mealPrep.delete).toHaveBeenCalledWith({ where: { id: 'prep-1' } });
    });

    it('should throw NotFoundException if meal prep not found', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.deleteMealPrep('nonexistent', userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not allow deleting another user meal prep', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.deleteMealPrep('prep-1', 'other-user'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // AI METHODS
  // ═══════════════════════════════════════════════════════════

  describe('generateMealPrep', () => {
    it('should throw BadRequestException if OpenAI not configured', async () => {
      // OpenAI is null in test environment
      await expect(
        service.generateMealPrep(
          { weekStartDate: '2026-03-16' },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // HELPERS (tested indirectly via createMealPrep)
  // ═══════════════════════════════════════════════════════════

  describe('computeTotals (via createMealPrep)', () => {
    it('should compute weekly totals as sum of daily totals', async () => {
      const week = buildMockWeek();
      (prisma.mealPrep.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prisma.mealPrep.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({
        id: 'prep-new',
        ...data,
      }));

      const result = await service.createMealPrep({ weekStartDate: '2026-03-16', days: week }, userId);

      const weeklyTotals = JSON.parse(JSON.stringify(result.weeklyTotals));
      // Monday has 1260 cal, Tue-Sun have 310 cal each (only breakfast has data)
      const expectedCals = 1260 + 310 * 6; // 3120
      expect(weeklyTotals.calories).toBe(expectedCals);
    });
  });

  describe('calculateWeekEndDate (via createMealPrep)', () => {
    it('should calculate end date as start + 6 days', async () => {
      const week = buildMockWeek();
      (prisma.mealPrep.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prisma.mealPrep.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({
        id: 'prep-new',
        ...data,
      }));

      const result = await service.createMealPrep({ weekStartDate: '2026-03-16', days: week }, userId);

      expect(result.weekEndDate).toBe('2026-03-22');
    });

    it('should handle month boundary correctly', async () => {
      const week = buildMockWeek();
      (prisma.mealPrep.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prisma.mealPrep.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({
        id: 'prep-new',
        ...data,
      }));

      const result = await service.createMealPrep({ weekStartDate: '2026-03-30', days: week }, userId);

      expect(result.weekEndDate).toBe('2026-04-05');
    });
  });
});
