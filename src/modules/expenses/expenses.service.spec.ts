import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../../config/prisma.service';

describe('ExpensesService', () => {
  let service: ExpensesService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockCategory = {
    id: 'cat-1',
    userId,
    name: 'Comida',
    icon: '🍔',
    color: 'chart-1',
    monthlyBudget: 100000,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockExpense = {
    id: 'exp-1',
    userId,
    date: '2026-08-03',
    amount: 15000,
    description: 'Supermercado',
    categoryId: 'cat-1',
    source: 'manual',
    recurringExpenseId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRecurring = {
    id: 'rec-1',
    userId,
    description: 'Netflix',
    amount: 12000,
    categoryId: 'cat-1',
    dayOfMonth: 5,
    kind: 'subscription',
    active: true,
    lastPostedPeriod: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        {
          provide: PrismaService,
          useValue: {
            expense: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            expenseCategory: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            recurringExpense: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            income: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<ExpensesService>(ExpensesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  // ── Gastos ────────────────────────────────────────────────

  describe('createExpense', () => {
    it('should create an expense', async () => {
      (prisma.expense.create as jest.Mock).mockResolvedValue(mockExpense);

      const result = await service.createExpense(userId, {
        date: '2026-08-03',
        amount: 15000,
        description: 'Supermercado',
        categoryId: 'cat-1',
      });

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          date: '2026-08-03',
          amount: 15000,
          description: 'Supermercado',
          categoryId: 'cat-1',
        }),
        include: { category: true },
      });
      expect(result).toEqual(mockExpense);
    });

    it('should reject a non-positive amount', async () => {
      await expect(
        service.createExpense(userId, {
          date: '2026-08-03',
          amount: 0,
          description: 'Nada',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });
  });

  describe('getExpenses', () => {
    it('should list the expenses of a month, newest first', async () => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([mockExpense]);

      const result = await service.getExpenses(userId, '2026-08');

      expect(prisma.expense.findMany).toHaveBeenCalledWith({
        where: { userId, date: { gte: '2026-08-01', lte: '2026-08-31' } },
        include: { category: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });
      expect(result).toEqual([mockExpense]);
    });
  });

  describe('deleteExpense', () => {
    it('should delete an owned expense', async () => {
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(mockExpense);
      (prisma.expense.delete as jest.Mock).mockResolvedValue(mockExpense);

      await service.deleteExpense(userId, 'exp-1');

      expect(prisma.expense.delete).toHaveBeenCalledWith({
        where: { id: 'exp-1' },
      });
    });

    it('should throw for a foreign expense', async () => {
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteExpense('otro', 'exp-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.expense.delete).not.toHaveBeenCalled();
    });
  });

  // ── Categorías ────────────────────────────────────────────

  describe('createCategory', () => {
    it('should create a category', async () => {
      (prisma.expenseCategory.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.expenseCategory.create as jest.Mock).mockResolvedValue(
        mockCategory,
      );

      const result = await service.createCategory(userId, {
        name: 'Comida',
        icon: '🍔',
        monthlyBudget: 100000,
      });

      expect(result).toEqual(mockCategory);
    });

    it('should reject a duplicate name', async () => {
      (prisma.expenseCategory.findFirst as jest.Mock).mockResolvedValue(
        mockCategory,
      );

      await expect(
        service.createCategory(userId, { name: 'comida' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateCategory', () => {
    it('should update the budget of an owned category', async () => {
      (prisma.expenseCategory.findFirst as jest.Mock).mockResolvedValue(
        mockCategory,
      );
      (prisma.expenseCategory.update as jest.Mock).mockResolvedValue({
        ...mockCategory,
        monthlyBudget: 150000,
      });

      const result = await service.updateCategory(userId, 'cat-1', {
        monthlyBudget: 150000,
      });

      expect(result.monthlyBudget).toBe(150000);
    });
  });

  // ── Recurrentes / suscripciones ───────────────────────────

  describe('createRecurring', () => {
    it('should create a recurring expense clamping dayOfMonth to 1-28', async () => {
      (prisma.recurringExpense.create as jest.Mock).mockResolvedValue(
        mockRecurring,
      );

      await service.createRecurring(userId, {
        description: 'Netflix',
        amount: 12000,
        dayOfMonth: 31,
        kind: 'subscription',
      });

      expect(prisma.recurringExpense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ dayOfMonth: 28 }),
        include: { category: true },
      });
    });
  });

  describe('postDueRecurringExpenses', () => {
    it('should post a due recurring expense once per period', async () => {
      (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
        mockRecurring,
      ]);
      (prisma.expense.create as jest.Mock).mockResolvedValue({
        ...mockExpense,
        source: 'recurring',
      });
      (prisma.recurringExpense.update as jest.Mock).mockResolvedValue({
        ...mockRecurring,
        lastPostedPeriod: '2026-08',
      });

      const posted = await service.postDueRecurringExpenses(
        new Date(2026, 7, 10), // 10 de agosto: día 5 ya pasó
      );

      expect(posted).toBe(1);
      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          date: '2026-08-05',
          amount: 12000,
          description: 'Netflix',
          source: 'recurring',
          recurringExpenseId: 'rec-1',
        }),
      });
      expect(prisma.recurringExpense.update).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: { lastPostedPeriod: '2026-08' },
      });
    });

    it('should not post before the dayOfMonth', async () => {
      (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
        mockRecurring,
      ]);

      const posted = await service.postDueRecurringExpenses(
        new Date(2026, 7, 3), // 3 de agosto: antes del día 5
      );

      expect(posted).toBe(0);
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });

    it('should not post twice in the same period', async () => {
      (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
        { ...mockRecurring, lastPostedPeriod: '2026-08' },
      ]);

      const posted = await service.postDueRecurringExpenses(
        new Date(2026, 7, 10),
      );

      expect(posted).toBe(0);
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });
  });

  // ── Ingresos (ventas 3D) ──────────────────────────────────

  describe('createIncome', () => {
    it('should create an income with cost portion and goal link', async () => {
      (prisma.income.create as jest.Mock).mockResolvedValue({
        id: 'inc-1',
        userId,
        date: '2026-08-01',
        description: 'Tetris x2 a Marcelito',
        amount: 17300,
        cost: 11500,
        source: '3d',
        goalId: 'goal-nz',
      });

      const result = await service.createIncome(userId, {
        date: '2026-08-01',
        description: 'Tetris x2 a Marcelito',
        amount: 17300,
        cost: 11500,
        goalId: 'goal-nz',
      });

      expect(prisma.income.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          amount: 17300,
          cost: 11500,
          goalId: 'goal-nz',
        }),
      });
      expect(result.amount).toBe(17300);
    });

    it('should reject cost greater than amount', async () => {
      await expect(
        service.createIncome(userId, {
          date: '2026-08-01',
          description: 'Venta',
          amount: 1000,
          cost: 2000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject a non-positive amount', async () => {
      await expect(
        service.createIncome(userId, {
          date: '2026-08-01',
          description: 'Venta',
          amount: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getBusinessSummary', () => {
    it('should mirror the sheet balance: invested vs profit', async () => {
      // Inversiones: gastos linkeados al objetivo (filamento + muestras)
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([
        { ...mockExpense, amount: 135480, goalId: 'goal-nz' },
        { ...mockExpense, id: 'exp-2', amount: 20200, goalId: 'goal-nz' },
      ]);
      (prisma.income.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'inc-1',
          amount: 17300,
          cost: 11500,
          date: '2026-08-01',
          description: 'Tetris x2',
        },
        {
          id: 'inc-2',
          amount: 7400,
          cost: 5700,
          date: '2026-08-02',
          description: 'Bandeja conteo',
        },
      ]);

      const s = await service.getBusinessSummary(userId);

      expect(s.invested).toBe(155680);
      expect(s.incomeTotal).toBe(24700);
      expect(s.costRecovered).toBe(17200);
      expect(s.profit).toBe(7500); // 5800 + 1700
      expect(s.balance).toBe(7500 - 155680);
      expect(s.toRecover).toBe(155680 - 7500);
    });
  });

  // ── Resumen ───────────────────────────────────────────────

  describe('getSummary', () => {
    it('should aggregate the month by category with budget status', async () => {
      (prisma.expense.findMany as jest.Mock)
        .mockResolvedValueOnce([
          { ...mockExpense, amount: 80000, categoryId: 'cat-1' },
          { ...mockExpense, id: 'exp-2', amount: 40000, categoryId: 'cat-1' },
          {
            ...mockExpense,
            id: 'exp-3',
            amount: 5000,
            categoryId: null,
            description: 'Kiosco',
          },
        ])
        .mockResolvedValueOnce([{ ...mockExpense, amount: 100000 }]); // mes anterior
      (prisma.expenseCategory.findMany as jest.Mock).mockResolvedValue([
        mockCategory,
      ]);
      (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
        mockRecurring,
      ]);

      const summary = await service.getSummary(userId, '2026-08');

      expect(summary.total).toBe(125000);
      expect(summary.prevMonthTotal).toBe(100000);
      const cat = summary.byCategory.find((c) => c.categoryId === 'cat-1');
      expect(cat).toMatchObject({
        name: 'Comida',
        amount: 120000,
        budget: 100000,
      });
      expect(cat!.budgetPct).toBe(120);
      expect(summary.uncategorized).toBe(5000);
      expect(summary.overBudget).toEqual(['Comida']);
      expect(summary.subscriptionsMonthly).toBe(12000);
      expect(summary.topExpenses[0].amount).toBe(80000);
    });
  });
});
