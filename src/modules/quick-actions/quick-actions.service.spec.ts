import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  QuickActionsService,
  slotForHour,
  dayKeyOf,
} from './quick-actions.service';
import { HydrationService } from '../hydration/hydration.service';
import { MealPrepService } from '../meal-prep/meal-prep.service';
import { NotesService } from '../notes/notes.service';
import { ExpensesService } from '../expenses/expenses.service';
import { ExpenseCategorizerService } from '../expenses/expense-categorizer.service';
import { AnalyzeFoodService } from '../analyze-food/analyze-food.service';
import { PhysicalActivitiesService } from '../physical-activities/physical-activities.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { SleepService } from '../sleep/sleep.service';
import { PrismaService } from '../../config/prisma.service';

describe('slotForHour', () => {
  it('should map hours to meal prep slots', () => {
    expect(slotForHour(8)).toBe('breakfast');
    expect(slotForHour(10)).toBe('breakfast');
    expect(slotForHour(12)).toBe('lunch');
    expect(slotForHour(14)).toBe('lunch');
    expect(slotForHour(16)).toBe('snack');
    expect(slotForHour(18)).toBe('snack');
    expect(slotForHour(21)).toBe('dinner');
    expect(slotForHour(1)).toBe('dinner'); // cena tardía / madrugada
  });
});

describe('dayKeyOf', () => {
  it('should map a YYYY-MM-DD to the meal prep day key', () => {
    expect(dayKeyOf('2026-08-03')).toBe('monday');
    expect(dayKeyOf('2026-08-06')).toBe('thursday');
    expect(dayKeyOf('2026-08-09')).toBe('sunday');
  });
});

describe('QuickActionsService', () => {
  let service: QuickActionsService;
  let hydration: HydrationService;
  let mealPrep: MealPrepService;
  let notes: NotesService;
  let expenses: ExpensesService;
  let analyzeFood: AnalyzeFoodService;
  let nutrition: NutritionService;
  let physical: PhysicalActivitiesService;
  let sleep: SleepService;

  const userId = 'user-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuickActionsService,
        {
          provide: HydrationService,
          useValue: {
            adjust: jest.fn().mockResolvedValue({ glassesConsumed: 5 }),
            getGoal: jest.fn().mockResolvedValue({ goalGlasses: 8 }),
          },
        },
        {
          provide: MealPrepService,
          useValue: {
            getActiveMealPrep: jest.fn(),
            markSlotEaten: jest.fn(),
          },
        },
        {
          provide: NotesService,
          useValue: { create: jest.fn().mockResolvedValue({ id: 'note-1' }) },
        },
        {
          provide: ExpensesService,
          useValue: {
            createExpense: jest
              .fn()
              .mockImplementation((_u, dto) =>
                Promise.resolve({ id: 'exp-1', ...dto }),
              ),
            getCategories: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ExpenseCategorizerService,
          useValue: { categorize: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: AnalyzeFoodService,
          useValue: {
            analyzeManualFood: jest.fn().mockResolvedValue({
              foods: [{ name: 'Milanesa con puré', calories: 650 }],
              totalCalories: 650,
              macronutrients: { protein: 35, carbs: 60, fat: 28 },
              confidence: 0.85,
            }),
          },
        },
        {
          provide: NutritionService,
          useValue: { create: jest.fn().mockResolvedValue({ id: 'na-1' }) },
        },
        {
          provide: PhysicalActivitiesService,
          useValue: {
            create: jest
              .fn()
              .mockImplementation((data) => Promise.resolve({ id: 'pa-1', ...data })),
          },
        },
        {
          provide: SleepService,
          useValue: {
            upsertSleep: jest
              .fn()
              .mockImplementation((_u, dto) =>
                Promise.resolve({ id: 'sleep-1', ...dto }),
              ),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            userPreferences: {
              findUnique: jest.fn().mockResolvedValue(null),
              upsert: jest.fn().mockImplementation(({ create, update }) =>
                Promise.resolve({ ...create, ...update }),
              ),
            },
            expense: {
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'tp-1', ...data }),
              ),
            },
          },
        },
      ],
    }).compile();

    service = module.get(QuickActionsService);
    hydration = module.get(HydrationService);
    mealPrep = module.get(MealPrepService);
    notes = module.get(NotesService);
    expenses = module.get(ExpensesService);
    analyzeFood = module.get(AnalyzeFoodService);
    nutrition = module.get(NutritionService);
    physical = module.get(PhysicalActivitiesService);
    sleep = module.get(SleepService);
  });

  describe('config', () => {
    let prisma: PrismaService;

    beforeEach(() => {
      prisma = (service as any).prisma;
    });

    it('should return defaults when nothing is stored', async () => {
      const c = await service.getConfig(userId);
      expect(c).toEqual({
        aguaVasosPorTap: 1,
        notaMoodDefault: 3,
        gastoCategoriaDefault: null,
      });
    });

    it('should merge stored values over defaults', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockResolvedValue({
        quickActions: { aguaVasosPorTap: 3 },
      });
      const c = await service.getConfig(userId);
      expect(c.aguaVasosPorTap).toBe(3);
      expect(c.notaMoodDefault).toBe(3);
    });

    it('should validate and persist partial updates', async () => {
      (prisma.userPreferences.findUnique as jest.Mock).mockResolvedValue({
        quickActions: { notaMoodDefault: 4 },
      });

      await service.setConfig(userId, { aguaVasosPorTap: 3 });

      expect(prisma.userPreferences.upsert).toHaveBeenCalledWith({
        where: { userId },
        create: expect.objectContaining({
          userId,
          quickActions: expect.objectContaining({
            aguaVasosPorTap: 3,
            notaMoodDefault: 4,
          }),
        }),
        update: expect.objectContaining({
          quickActions: expect.objectContaining({
            aguaVasosPorTap: 3,
            notaMoodDefault: 4,
          }),
        }),
      });
    });

    it('should reject out-of-range values', async () => {
      await expect(
        service.setConfig(userId, { aguaVasosPorTap: 0 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setConfig(userId, { notaMoodDefault: 6 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('agua', () => {
    it('should add one glass for today and report progress', async () => {
      const r = await service.agua(userId);

      expect(hydration.adjust).toHaveBeenCalledWith(userId, {
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        delta: 1,
      });
      expect(r.message).toContain('5/8');
    });

    it('should use the configured vasos-por-tap when no explicit count', async () => {
      ((service as any).prisma.userPreferences.findUnique as jest.Mock)
        .mockResolvedValue({ quickActions: { aguaVasosPorTap: 3 } });

      await service.agua(userId);

      expect(hydration.adjust).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ delta: 3 }),
      );
    });

    it('should accept a custom glass count', async () => {
      await service.agua(userId, 2);
      expect(hydration.adjust).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ delta: 2 }),
      );
    });
  });

  describe('comidaPlan', () => {
    it('should mark the slot matching the current ART hour', async () => {
      // 15:00 UTC = 12:00 ART → lunch
      jest.useFakeTimers().setSystemTime(new Date('2026-08-06T15:00:00Z'));
      try {
        (mealPrep.getActiveMealPrep as jest.Mock).mockResolvedValue({
          id: 'prep-1',
        });
        (mealPrep.markSlotEaten as jest.Mock).mockResolvedValue({
          slot: { name: 'Milanesa con ensalada' },
        });

        const r = await service.comidaPlan(userId);

        expect(mealPrep.markSlotEaten).toHaveBeenCalledWith(
          'prep-1',
          {
            day: 'thursday',
            mealType: 'lunch',
            date: '2026-08-06',
          },
          userId,
        );
        expect(r.message).toContain('lunch');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should fail clearly when there is no active meal prep', async () => {
      (mealPrep.getActiveMealPrep as jest.Mock).mockResolvedValue(null);

      await expect(service.comidaPlan(userId)).rejects.toThrow(
        BadRequestException,
      );
      expect(mealPrep.markSlotEaten).not.toHaveBeenCalled();
    });
  });

  describe('comida (fuera del meal prep, dictada)', () => {
    it('should analyze the dictated text and persist it with the current slot', async () => {
      // 15:00 UTC = 12:00 ART → lunch
      jest.useFakeTimers().setSystemTime(new Date('2026-08-06T15:00:00Z'));
      try {
        const r = await service.comida(userId, 'milanesa con puré y una coca');

        expect(analyzeFood.analyzeManualFood).toHaveBeenCalledWith(
          'milanesa con puré y una coca',
          1,
          'lunch',
          undefined,
          userId,
        );
        expect(nutrition.create).toHaveBeenCalledWith(
          expect.objectContaining({
            date: '2026-08-06',
            mealType: 'lunch',
            totalCalories: 650,
            aiConfidence: 0.85,
          }),
          userId,
        );
        expect(r.message).toContain('650');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should reject empty text', async () => {
      await expect(service.comida(userId, '  ')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('entreno', () => {
    it('should log a workout with minutes and calories for today', async () => {
      const r = await service.entreno(userId, {
        minutos: 45,
        kcal: 320,
        tipo: 'Handball',
      });

      expect(physical.create).toHaveBeenCalledWith(
        expect.objectContaining({
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          exerciseMinutes: 45,
          activeEnergyKcal: 320,
          context: 'Handball',
        }),
        userId,
      );
      expect(r.message).toContain('45');
    });

    it('should reject a workout with no data at all', async () => {
      await expect(service.entreno(userId, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('sueno', () => {
    it('should log last night with what the shortcut sends and answer with the duration', async () => {
      const r = await service.sueno(userId, {
        duracion: '7:45',
        calidad: 4,
        acoste: '23:15',
        desperte: '07:00',
      });

      expect(sleep.upsertSleep).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          minutesAsleep: 465,
          quality: 4,
          bedTime: '23:15',
          wakeTime: '07:00',
          source: 'shortcut',
        }),
      );
      expect(r.message).toContain('7h 45m');
    });

    it('should compute the duration from the times when the Wake automation sends no duration', async () => {
      // La automatización Wake de iOS no pasa input: el atajo manda los
      // horarios crudos de la muestra de Health y la cuenta la hacemos acá.
      const r = await service.sueno(userId, {
        acoste: '2026-08-05T23:15:00-03:00',
        desperte: '2026-08-06T07:00:00-03:00',
      });

      expect(sleep.upsertSleep).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          minutesAsleep: 465,
          bedTime: '23:15',
          wakeTime: '07:00',
        }),
      );
      expect(r.message).toContain('7h 45m');
    });

    it('should reject when there is neither a duration nor usable times', async () => {
      await expect(
        service.sueno(userId, { duracion: 'dormí mal' }),
      ).rejects.toThrow(BadRequestException);
      await expect(service.sueno(userId, { acoste: '23:15' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should echo back what arrived so the shortcut can be debugged', async () => {
      // Sin esto, desde el celular no hay forma de ver qué mandó el atajo.
      await expect(
        service.sueno(userId, { acoste: '', desperte: '' }),
      ).rejects.toThrow(/acoste=\(vacío\).*desperte=\(vacío\)/s);

      await expect(
        service.sueno(userId, { acoste: 'Hoy 23:15', desperte: '' }),
      ).rejects.toThrow(/acoste="Hoy 23:15"/);
    });
  });

  describe('gasto', () => {
    it('should create a quick expense for today', async () => {
      const r = await service.gasto(userId, 5000, 'Kiosco');

      expect(expenses.createExpense).toHaveBeenCalledWith(userId, {
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        amount: 5000,
        description: 'Kiosco',
        categoryId: null,
      });
      expect(r.message).toContain('5.000');
    });

    it('should send credit-card expenses to the tarjeta-pendiente buffer (no gasto del mes)', async () => {
      const r = await service.gasto(userId, 43678, 'Filamentos Proyectocolor', true);

      expect(expenses.createExpense).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          amount: 43678,
          description: 'Filamentos Proyectocolor',
          tarjeta: true,
        }),
      );
      expect(r.message).toContain('próximo resumen');
    });

    it('should buffer on another card when tarjeta is a card name', async () => {
      const r = await service.gasto(userId, 12000, 'Cena', 'Hermano');

      expect(expenses.createExpense).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ tarjeta: true, card: 'Hermano' }),
      );
      expect(r.message).toContain('Hermano');
    });

    it('should attach the configured default category when it exists', async () => {
      ((service as any).prisma.userPreferences.findUnique as jest.Mock)
        .mockResolvedValue({
          quickActions: { gastoCategoriaDefault: 'Comida' },
        });
      (expenses.getCategories as jest.Mock).mockResolvedValue([
        { id: 'cat-food', name: 'Comida' },
      ]);

      await service.gasto(userId, 5000, 'Kiosco');

      expect(expenses.createExpense).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ categoryId: 'cat-food' }),
      );
    });
  });

  describe('nota', () => {
    it('should create a reflection with default mood 3', async () => {
      await service.nota(userId, 'Buen día, entrené y comí bien');

      expect(notes.create).toHaveBeenCalledWith(
        expect.objectContaining({
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          content: 'Buen día, entrené y comí bien',
          mood: 3,
        }),
        userId,
      );
    });

    it('should use the configured default mood', async () => {
      ((service as any).prisma.userPreferences.findUnique as jest.Mock)
        .mockResolvedValue({ quickActions: { notaMoodDefault: 4 } });

      await service.nota(userId, 'día pesado');

      expect(notes.create).toHaveBeenCalledWith(
        expect.objectContaining({ mood: 4 }),
        userId,
      );
    });

    it('should clamp mood to 1-5', async () => {
      await service.nota(userId, 'texto', 9);
      expect(notes.create).toHaveBeenCalledWith(
        expect.objectContaining({ mood: 5 }),
        userId,
      );
    });

    it('should reject empty text', async () => {
      await expect(service.nota(userId, '  ')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
