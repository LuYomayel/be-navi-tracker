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
          },
        },
      ],
    }).compile();

    service = module.get(QuickActionsService);
    hydration = module.get(HydrationService);
    mealPrep = module.get(MealPrepService);
    notes = module.get(NotesService);
    expenses = module.get(ExpensesService);
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

  describe('gasto', () => {
    it('should create a quick expense for today', async () => {
      const r = await service.gasto(userId, 5000, 'Kiosco');

      expect(expenses.createExpense).toHaveBeenCalledWith(userId, {
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        amount: 5000,
        description: 'Kiosco',
      });
      expect(r.message).toContain('5.000');
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
