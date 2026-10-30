import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpensesService, recurringEndPeriod } from './expenses.service';
import { ExpenseCategorizerService } from './expense-categorizer.service';
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
    totalInstallments: null,
    installmentsPaid: 0,
    startPeriod: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        {
          provide: ExpenseCategorizerService,
          useValue: { categorize: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: PrismaService,
          useValue: {
            expense: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
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
            creditCard: {
              findMany: jest.fn().mockResolvedValue([]),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
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

    it('should buffer a credit card consumption (tarjeta) instead of a regular expense', async () => {
      (prisma.expense.create as jest.Mock).mockResolvedValue(mockExpense);

      await service.createExpense(userId, {
        date: '2026-08-06',
        amount: 20000,
        description: 'Nafta YPF',
        tarjeta: true,
      });

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: 'tarjeta-pendiente',
          card: null,
        }),
        include: { category: true },
      });
    });

    it('should buffer on another card when card is given', async () => {
      (prisma.expense.create as jest.Mock).mockResolvedValue(mockExpense);

      await service.createExpense(userId, {
        date: '2026-08-06',
        amount: 8000,
        description: 'Comida',
        card: 'Hermano',
      });

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: 'tarjeta-pendiente',
          card: 'Hermano',
        }),
        include: { category: true },
      });
    });
  });

  describe('getExpenses', () => {
    it('should list the expenses of a month, newest first', async () => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([mockExpense]);

      const result = await service.getExpenses(userId, '2026-08');

      expect(prisma.expense.findMany).toHaveBeenCalledWith({
        where: {
          userId,
          date: { gte: '2026-08-01', lte: '2026-08-31' },
          source: { notIn: ['tarjeta-pendiente', 'tarjeta-saldada'] },
        },
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

  // ── Cuotas (pagos recurrentes con fin) ────────────────────

  describe('createRecurring con cuotas', () => {
    it('should persist total and explicit paid installments', async () => {
      (prisma.recurringExpense.create as jest.Mock).mockResolvedValue({});

      await service.createRecurring(userId, {
        description: 'Cuota celular',
        amount: 50000,
        dayOfMonth: 10,
        totalInstallments: 12,
        installmentsPaid: 3,
      });

      expect(prisma.recurringExpense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          totalInstallments: 12,
          installmentsPaid: 3,
          active: true,
        }),
        include: { category: true },
      });
    });

    it('should derive paid installments from a past startPeriod (months before the current one)', async () => {
      // Arrancó en marzo; estamos en agosto → mar/abr/may/jun/jul = 5 pagadas.
      // La de agosto la postea el cron normal (aparece como gasto del mes).
      jest.useFakeTimers().setSystemTime(new Date(2026, 7, 15));
      try {
        (prisma.recurringExpense.create as jest.Mock).mockResolvedValue({});

        await service.createRecurring(userId, {
          description: 'Cuota heladera',
          amount: 80000,
          dayOfMonth: 10,
          totalInstallments: 12,
          startPeriod: '2026-03',
        });

        expect(prisma.recurringExpense.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            startPeriod: '2026-03',
            totalInstallments: 12,
            installmentsPaid: 5,
            active: true,
          }),
          include: { category: true },
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('should create finished (inactive) if the past startPeriod already covers all installments', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 7, 15));
      try {
        (prisma.recurringExpense.create as jest.Mock).mockResolvedValue({});

        await service.createRecurring(userId, {
          description: 'Cuota vieja',
          amount: 10000,
          dayOfMonth: 10,
          totalInstallments: 3,
          startPeriod: '2026-01',
        });

        expect(prisma.recurringExpense.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            installmentsPaid: 3,
            active: false,
          }),
          include: { category: true },
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('should reject invalid installments or startPeriod format', async () => {
      await expect(
        service.createRecurring(userId, {
          description: 'X',
          amount: 100,
          dayOfMonth: 1,
          totalInstallments: 0,
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createRecurring(userId, {
          description: 'X',
          amount: 100,
          dayOfMonth: 1,
          startPeriod: 'marzo',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
    });
  });

  describe('postDueRecurringExpenses con cuotas', () => {
    const cuotaRec = {
      ...mockRecurring,
      id: 'rec-2',
      description: 'Cuota celular',
      amount: 50000,
      totalInstallments: 12,
      installmentsPaid: 5,
      startPeriod: '2026-03',
    };

    it('should post with the installment number in the description and increment the counter', async () => {
      (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
        cuotaRec,
      ]);
      (prisma.expense.create as jest.Mock).mockResolvedValue({});
      (prisma.recurringExpense.update as jest.Mock).mockResolvedValue({});

      await service.postDueRecurringExpenses(new Date(2026, 7, 10));

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: 'Cuota celular (cuota 6/12)',
        }),
      });
      expect(prisma.recurringExpense.update).toHaveBeenCalledWith({
        where: { id: 'rec-2' },
        data: expect.objectContaining({
          lastPostedPeriod: '2026-08',
          installmentsPaid: 6,
          active: true,
        }),
      });
    });

    it('should deactivate the recurring after posting the last installment', async () => {
      (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
        // arrancó en sep-25 → agosto-26 es la 12ª por calendario
        { ...cuotaRec, installmentsPaid: 11, startPeriod: '2025-09' },
      ]);
      (prisma.expense.create as jest.Mock).mockResolvedValue({});
      (prisma.recurringExpense.update as jest.Mock).mockResolvedValue({});

      await service.postDueRecurringExpenses(new Date(2026, 7, 10));

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: 'Cuota celular (cuota 12/12)',
        }),
      });
      expect(prisma.recurringExpense.update).toHaveBeenCalledWith({
        where: { id: 'rec-2' },
        data: expect.objectContaining({
          installmentsPaid: 12,
          active: false,
        }),
      });
    });

    it('should post a card recurring into the tarjeta-pendiente buffer of that card', async () => {
      (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
        { ...cuotaRec, tarjeta: true, card: 'Hermano' },
      ]);
      (prisma.expense.create as jest.Mock).mockResolvedValue({});
      (prisma.recurringExpense.update as jest.Mock).mockResolvedValue({});

      await service.postDueRecurringExpenses(new Date(2026, 7, 10));

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: 'Cuota celular (cuota 6/12)',
          source: 'tarjeta-pendiente',
          card: 'Hermano',
        }),
      });
    });

    it('should not post before the startPeriod (cuotas que arrancan en el futuro)', async () => {
      (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
        { ...cuotaRec, startPeriod: '2026-10', installmentsPaid: 0 },
      ]);

      const posted = await service.postDueRecurringExpenses(
        new Date(2026, 7, 10),
      );

      expect(posted).toBe(0);
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });
  });

  describe('recurringEndPeriod', () => {
    it('should compute the end month from startPeriod + total installments', () => {
      // Arrancó 2026-03, 12 cuotas → la última es 2027-02
      expect(
        recurringEndPeriod(
          {
            totalInstallments: 12,
            installmentsPaid: 5,
            startPeriod: '2026-03',
            lastPostedPeriod: '2026-07',
          },
          new Date(2026, 7, 15),
        ),
      ).toBe('2027-02');
    });

    it('should estimate from the counter when there is no startPeriod', () => {
      // 12 cuotas, 3 pagadas, la de este mes aún no se posteó:
      // ago=4 ... abr=12 → termina 2027-04
      expect(
        recurringEndPeriod(
          {
            totalInstallments: 12,
            installmentsPaid: 3,
            startPeriod: null,
            lastPostedPeriod: '2026-07',
          },
          new Date(2026, 7, 15),
        ),
      ).toBe('2027-04');
      // Si la de este mes ya se posteó, la próxima es sep → termina 2027-04
      expect(
        recurringEndPeriod(
          {
            totalInstallments: 12,
            installmentsPaid: 4,
            startPeriod: null,
            lastPostedPeriod: '2026-08',
          },
          new Date(2026, 7, 15),
        ),
      ).toBe('2027-04');
    });

    it('should return null for endless or finished recurrings', () => {
      expect(
        recurringEndPeriod(
          {
            totalInstallments: null,
            installmentsPaid: 0,
            startPeriod: null,
            lastPostedPeriod: null,
          },
          new Date(2026, 7, 15),
        ),
      ).toBeNull();
      expect(
        recurringEndPeriod(
          {
            totalInstallments: 12,
            installmentsPaid: 12,
            startPeriod: '2025-01',
            lastPostedPeriod: '2025-12',
          },
          new Date(2026, 7, 15),
        ),
      ).toBeNull();
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

    it('should default to the Argentina local date, not the UTC one', async () => {
      // 02:00 UTC del 4 son las 23:00 ART del 3: en UTC la fecha ya adelanto
      // un dia, asi que un ingreso cargado de noche caia en el dia siguiente.
      jest.useFakeTimers().setSystemTime(new Date('2026-08-04T02:00:00Z'));
      try {
        (prisma.income.create as jest.Mock).mockResolvedValue({ id: 'inc-2' });

        await service.createIncome(userId, {
          description: 'Venta nocturna',
          amount: 5000,
        });

        expect(prisma.income.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ date: '2026-08-03' }),
        });
      } finally {
        jest.useRealTimers();
      }
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

    it('should only count 3d incomes already received (salary must not inflate the NZ fund)', async () => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.income.findMany as jest.Mock).mockResolvedValue([]);

      await service.getBusinessSummary(userId);

      expect(prisma.income.findMany).toHaveBeenCalledWith({
        where: { userId, source: '3d', status: 'received' },
      });
    });
  });

  // ── Ingresos generales (sueldo, devoluciones, pendientes) ──

  describe('createIncome (general)', () => {
    it('should create a salary income with explicit source, received by default', async () => {
      (prisma.income.create as jest.Mock).mockResolvedValue({ id: 'inc-3' });

      await service.createIncome(userId, {
        date: '2026-08-01',
        description: 'Sueldo PulpoU',
        amount: 2000000,
        source: 'sueldo',
      });

      expect(prisma.income.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: 'sueldo',
          status: 'received',
          cost: 0,
        }),
      });
    });

    it('should create a pending income (por cobrar)', async () => {
      (prisma.income.create as jest.Mock).mockResolvedValue({ id: 'inc-4' });

      await service.createIncome(userId, {
        description: 'Venta cafetera',
        amount: 80000,
        source: 'venta',
        status: 'pending',
      });

      expect(prisma.income.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'pending', source: 'venta' }),
      });
    });

    it('should reject an invalid status', async () => {
      await expect(
        service.createIncome(userId, {
          description: 'X',
          amount: 100,
          status: 'whatever' as any,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.income.create).not.toHaveBeenCalled();
    });
  });

  describe('markIncomeReceived', () => {
    it('should mark a pending income as received, re-dating it to the payment date', async () => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue({
        id: 'inc-4',
        userId,
        status: 'pending',
        date: '2026-07-20',
      });
      (prisma.income.update as jest.Mock).mockResolvedValue({
        id: 'inc-4',
        status: 'received',
        date: '2026-08-05',
      });

      const result = await service.markIncomeReceived(
        userId,
        'inc-4',
        '2026-08-05',
      );

      expect(prisma.income.update).toHaveBeenCalledWith({
        where: { id: 'inc-4' },
        data: { status: 'received', date: '2026-08-05' },
      });
      expect(result.status).toBe('received');
    });

    it('should throw for a foreign or missing income', async () => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.markIncomeReceived(userId, 'nope'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.income.update).not.toHaveBeenCalled();
    });

    it('should reject if the income is already received', async () => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue({
        id: 'inc-1',
        userId,
        status: 'received',
      });

      await expect(
        service.markIncomeReceived(userId, 'inc-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.income.update).not.toHaveBeenCalled();
    });
  });

  describe('getPendingIncomes', () => {
    it('should list pending incomes oldest first', async () => {
      (prisma.income.findMany as jest.Mock).mockResolvedValue([]);

      await service.getPendingIncomes(userId);

      expect(prisma.income.findMany).toHaveBeenCalledWith({
        where: { userId, status: 'pending' },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('getMonthProjection', () => {
    it('should project the rest of the month: committed future expenses, pending recurrings and expected incomes', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 7, 6, 12)); // 6 de agosto
      try {
        (prisma.expense.findMany as jest.Mock).mockResolvedValue([
          { ...mockExpense, amount: 100000, date: '2026-08-03' }, // ejecutado
          {
            ...mockExpense,
            id: 'exp-f',
            amount: 50000,
            date: '2026-08-11',
            description: 'Sesión psicóloga',
          }, // futuro
        ]);
        (prisma.income.findMany as jest.Mock)
          // cobrados del mes
          .mockResolvedValueOnce([
            { id: 'i1', amount: 500000, source: 'sueldo', status: 'received', date: '2026-08-01' },
          ])
          // pendientes con fecha en el mes
          .mockResolvedValueOnce([
            {
              id: 'i2',
              amount: 205000,
              source: 'sueldo',
              status: 'pending',
              date: '2026-08-21',
              description: 'Aguinaldo',
            },
          ]);
        (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
          // pendiente de postear este mes (día 16)
          { ...mockRecurring, id: 'r1', amount: 167000, dayOfMonth: 16, lastPostedPeriod: '2026-07', totalInstallments: 12, installmentsPaid: 7, startPeriod: '2026-01' },
          // ya posteado este mes → no cuenta
          { ...mockRecurring, id: 'r2', amount: 90000, lastPostedPeriod: '2026-08' },
          // arranca en el futuro → no cuenta este mes
          { ...mockRecurring, id: 'r3', amount: 500, startPeriod: '2026-10', totalInstallments: 3, installmentsPaid: 0, lastPostedPeriod: null },
        ]);

        const pr = await service.getMonthProjection(userId, '2026-08');

        expect(pr.gastosEjecutados).toBe(100000);
        expect(pr.gastosFuturosTotal).toBe(50000);
        expect(pr.gastosFuturos[0].description).toBe('Sesión psicóloga');
        expect(pr.recurrentesPorVenirTotal).toBe(167000);
        expect(pr.ingresosEsperadosTotal).toBe(205000);
        expect(pr.saldoHoy).toBe(400000); // 500k - 100k
        // 400k - 50k futuro - 167k recurrente + 205k aguinaldo
        expect(pr.disponibleProyectado).toBe(388000);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should group pending card consumptions by card (mia = null primero, luego el resto)', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 7, 6, 12));
      try {
        (prisma.expense.findMany as jest.Mock).mockImplementation(({ where }) =>
          where.source === 'tarjeta-pendiente'
            ? Promise.resolve([
                { id: 't1', date: '2026-08-03', amount: 43678, description: 'Filamentos', card: null },
                { id: 't2', date: '2026-08-04', amount: 12000, description: 'Cena', card: 'Hermano' },
                { id: 't3', date: '2026-08-05', amount: 3490, description: 'Meli+', card: null },
              ])
            : Promise.resolve([]),
        );
        (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([]);

        const pr = await service.getMonthProjection(userId, '2026-08');

        expect(pr.tarjetaPendienteTotal).toBe(59168);
        expect(pr.tarjetaPendientePorTarjeta).toEqual([
          expect.objectContaining({
            card: null,
            label: 'Visa',
            total: 47168,
            items: [
              expect.objectContaining({ id: 't1' }),
              expect.objectContaining({ id: 't3' }),
            ],
          }),
          expect.objectContaining({
            card: 'Hermano',
            label: 'Hermano',
            total: 12000,
            items: [expect.objectContaining({ id: 't2' })],
          }),
        ]);
        // los items del flat siguen saliendo (compat con la app vieja) y traen card
        expect(pr.tarjetaPendiente).toHaveLength(3);
        expect(pr.tarjetaPendiente[1].card).toBe('Hermano');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should keep card recurrings out of the cash projection and show them as pending on their card', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 7, 6, 12));
      try {
        (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
          // en efectivo/débito: sí resta del disponible
          { ...mockRecurring, id: 'r-cash', amount: 90000, dayOfMonth: 10 },
          // con la tarjeta del hermano: NO resta, va a la deuda de esa tarjeta
          {
            ...mockRecurring,
            id: 'r-card',
            description: 'Spotify',
            amount: 8000,
            dayOfMonth: 20,
            tarjeta: true,
            card: 'Hermano',
          },
        ]);

        const pr = await service.getMonthProjection(userId, '2026-08');

        expect(pr.recurrentesPorVenirTotal).toBe(90000);
        expect(pr.recurrentesPorVenir.map((r) => r.id)).toEqual(['r-cash']);
        expect(pr.disponibleProyectado).toBe(-90000);

        const hermano = pr.tarjetaPendientePorTarjeta.find(
          (g) => g.card === 'Hermano',
        )!;
        expect(hermano.total).toBe(8000);
        expect(hermano.items[0]).toEqual(
          expect.objectContaining({
            description: 'Spotify',
            amount: 8000,
            date: '2026-08-20',
            pending: true,
          }),
        );
        expect(pr.tarjetaPendienteTotal).toBe(8000);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('getMonthlyBalance', () => {
    it('should exclude tarjeta-pendiente consumptions from the month expenses', async () => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.income.findMany as jest.Mock).mockResolvedValue([]);

      await service.getMonthlyBalance(userId, '2026-08');

      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            source: { notIn: ['tarjeta-pendiente', 'tarjeta-saldada'] },
          }),
        }),
      );
    });

    it('should compute incomes vs expenses with refunds and pending broken out', async () => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([
        { ...mockExpense, amount: 100000 },
        { ...mockExpense, id: 'exp-2', amount: 50000 },
      ]);
      (prisma.income.findMany as jest.Mock)
        // ingresos cobrados del mes
        .mockResolvedValueOnce([
          { id: 'i1', amount: 2000000, cost: 0, source: 'sueldo' },
          { id: 'i2', amount: 17300, cost: 11500, source: '3d' },
          { id: 'i3', amount: 20000, cost: 0, source: 'devolucion' },
        ])
        // pendientes por cobrar (cualquier fecha)
        .mockResolvedValueOnce([
          {
            id: 'i4',
            amount: 80000,
            source: 'venta',
            description: 'Cafetera',
            date: '2026-08-01',
          },
        ]);

      const b = await service.getMonthlyBalance(userId, '2026-08');

      expect(prisma.income.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          userId,
          status: 'received',
          date: { gte: '2026-08-01', lte: '2026-08-31' },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });
      expect(b.expensesTotal).toBe(150000);
      expect(b.incomesTotal).toBe(2017300); // sueldo + 3d (sin devoluciones)
      expect(b.refundsTotal).toBe(20000);
      expect(b.netExpenses).toBe(130000); // gastos - devoluciones
      expect(b.balance).toBe(2017300 + 20000 - 150000);
      expect(b.bySource).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: 'sueldo', amount: 2000000 }),
          expect.objectContaining({ source: '3d', amount: 17300 }),
        ]),
      );
      expect(b.pendingTotal).toBe(80000);
      expect(b.pending).toHaveLength(1);
    });

    it('should handle a month with no data', async () => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.income.findMany as jest.Mock).mockResolvedValue([]);

      const b = await service.getMonthlyBalance(userId, '2026-08');

      expect(b.expensesTotal).toBe(0);
      expect(b.incomesTotal).toBe(0);
      expect(b.balance).toBe(0);
      expect(b.pending).toEqual([]);
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

  // ── Cuotas numeradas por calendario ───────────────────────

  describe('postDueRecurringExpenses con cuotas pagadas por adelantado', () => {
    // Trimetra3d: 3 cuotas, la 1ª en sep-26; la 2ª ya entró en un resumen
    // pagado (cuotas_pagadas=2) → octubre no se postea, noviembre va la 3/3.
    const trimetra = {
      ...mockRecurring,
      id: 'rec-tri',
      description: 'Trimetra3d',
      amount: 192966.66,
      dayOfMonth: 14,
      kind: 'recurring',
      totalInstallments: 3,
      installmentsPaid: 2,
      startPeriod: '2026-09',
      tarjeta: true,
      card: 'Leandro',
    };

    it('should not post the cuota of a month that is already paid', async () => {
      (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([trimetra]);

      const posted = await service.postDueRecurringExpenses(new Date(2026, 9, 30));

      expect(posted).toBe(0);
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });

    it('should number the cuota by calendar from startPeriod', async () => {
      (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([trimetra]);
      (prisma.expense.create as jest.Mock).mockResolvedValue({});
      (prisma.recurringExpense.update as jest.Mock).mockResolvedValue({});

      await service.postDueRecurringExpenses(new Date(2026, 10, 14));

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: 'Trimetra3d (cuota 3/3)',
          date: '2026-11-14',
          source: 'tarjeta-pendiente',
          card: 'Leandro',
        }),
      });
      expect(prisma.recurringExpense.update).toHaveBeenCalledWith({
        where: { id: 'rec-tri' },
        data: expect.objectContaining({ installmentsPaid: 3, active: false }),
      });
    });
  });

  describe('updateRecurring', () => {
    const bambu = {
      ...mockRecurring,
      id: 'rec-bambu',
      description: 'Cuota impresora Bambu',
      amount: 167000,
      totalInstallments: 12,
      installmentsPaid: 10,
      startPeriod: '2026-01',
    };

    beforeEach(() => {
      (prisma.recurringExpense.findFirst as jest.Mock).mockResolvedValue(bambu);
      (prisma.recurringExpense.update as jest.Mock).mockImplementation(
        ({ data }) => Promise.resolve({ ...bambu, ...data }),
      );
    });

    it('should mark a plan as finished (pagado por adelantado): all cuotas paid and inactive', async () => {
      await service.updateRecurring(userId, 'rec-bambu', { finished: true });

      expect(prisma.recurringExpense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ installmentsPaid: 12, active: false }),
        }),
      );
    });

    it('should deactivate when the paid cuotas reach the total', async () => {
      await service.updateRecurring(userId, 'rec-bambu', { installmentsPaid: 12 });

      expect(prisma.recurringExpense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ installmentsPaid: 12, active: false }),
        }),
      );
    });

    it('should throw if the recurring does not exist', async () => {
      (prisma.recurringExpense.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.updateRecurring(userId, 'nope', { amount: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Gastos en dólares ─────────────────────────────────────

  describe('gastos en USD', () => {
    it('should store the USD amount and rate, and the ARS equivalent as amount', async () => {
      (prisma.expense.create as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve({ id: 'e-usd', ...data }),
      );

      await service.createExpense(userId, {
        date: '2026-11-02',
        description: 'Servidor NaviTracker + EaseTrain',
        amountUsd: 20,
        exchangeRate: 1560,
      });

      expect(prisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 31200,
            originalAmount: 20,
            originalCurrency: 'USD',
            exchangeRate: 1560,
          }),
        }),
      );
    });

    it('should reject a USD expense without exchange rate', async () => {
      await expect(
        service.createExpense(userId, {
          date: '2026-11-02',
          description: 'Servidor',
          amountUsd: 20,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should recalculate the ARS amount when only the rate of a USD expense changes', async () => {
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue({
        ...mockExpense,
        amount: 31200,
        originalAmount: 20,
        originalCurrency: 'USD',
        exchangeRate: 1560,
      });
      (prisma.expense.update as jest.Mock).mockResolvedValue({});

      await service.updateExpense(userId, 'exp-1', { exchangeRate: 1600 });

      expect(prisma.expense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 32000, exchangeRate: 1600 }),
        }),
      );
    });

    it('should convert an existing ARS expense to USD', async () => {
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(mockExpense);
      (prisma.expense.update as jest.Mock).mockResolvedValue({});

      await service.updateExpense(userId, 'exp-1', {
        amountUsd: 44,
        exchangeRate: 1560,
      });

      expect(prisma.expense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 68640,
            originalAmount: 44,
            originalCurrency: 'USD',
            exchangeRate: 1560,
          }),
        }),
      );
    });
  });

  // ── Resumen de tarjeta ────────────────────────────────────

  describe('payCardStatement', () => {
    const buffer = [
      { id: 'b1', date: '2026-09-07', amount: 40000, description: 'Service Kwid (cuota 1/3)', card: 'Leandro' },
      { id: 'b2', date: '2026-10-07', amount: 40000, description: 'Service Kwid (cuota 2/3)', card: 'leandro' },
      { id: 'b3', date: '2026-11-03', amount: 5000, description: 'Nafta', card: 'Leandro' }, // después del cierre
      { id: 'b4', date: '2026-10-01', amount: 9999, description: 'Otra', card: 'Primo' },
    ];

    beforeEach(() => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue(buffer);
      (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([]);
      let n = 0;
      (prisma.expense.create as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve({ id: `st-${++n}`, ...data }),
      );
      (prisma.expense.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
    });

    it('should create the statement payment as a real expense and settle the card buffer up to the closing date', async () => {
      const res = await service.payCardStatement(userId, {
        card: 'LEANDRO',
        amount: 561011.7,
        date: '2026-11-11',
        closingDate: '2026-10-31',
      });

      expect(prisma.expense.create).toHaveBeenCalledTimes(1);
      expect(prisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            date: '2026-11-11',
            amount: 561011.7,
            source: 'resumen-tarjeta',
            card: 'Leandro', // nombre canónico del buffer
          }),
        }),
      );
      expect(prisma.expense.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['b1', 'b2'] }, userId },
        data: { source: 'tarjeta-saldada', statementId: 'st-1' },
      });
      expect(res.settledTotal).toBe(80000);
      expect(res.total).toBe(561011.7);
      expect(res.untracked).toBeCloseTo(481011.7, 2);
    });

    it('should split the USD part into its own expense with the rate (tarjeta propia = null)', async () => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([
        { id: 'v1', date: '2026-08-04', amount: 68008, description: 'YPF', card: null },
      ]);

      const res = await service.payCardStatement(userId, {
        card: null,
        amount: 454455,
        amountUsd: 44,
        exchangeRate: 1560,
        date: '2026-11-02',
      });

      expect(prisma.expense.create).toHaveBeenCalledTimes(2);
      expect(prisma.expense.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 68640,
            originalAmount: 44,
            originalCurrency: 'USD',
            exchangeRate: 1560,
            source: 'resumen-tarjeta',
            card: null,
          }),
        }),
      );
      expect(prisma.expense.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['v1'] }, userId },
        data: { source: 'tarjeta-saldada', statementId: 'st-1' },
      });
      expect(res.total).toBe(454455 + 68640);
    });

    it('should reject USD without rate and empty statements', async () => {
      await expect(
        service.payCardStatement(userId, { card: null, amountUsd: 44, date: '2026-11-02' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.payCardStatement(userId, { card: null, date: '2026-11-02' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMonthProjection con resúmenes estimados', () => {
    const leandroRecs = [
      // fijo mensual sin fin con la tarjeta del hermano, arranca en noviembre
      { ...mockRecurring, id: 'r-seg', description: 'Seguro La Meridional', amount: 150573.71, dayOfMonth: 2, kind: 'recurring', startPeriod: '2026-11', tarjeta: true, card: 'Leandro' },
      // cuotas: la 3/3 cae en noviembre → se paga en el resumen de diciembre
      { ...mockRecurring, id: 'r-tri', description: 'Trimetra3d', amount: 192966.66, dayOfMonth: 14, kind: 'recurring', totalInstallments: 3, installmentsPaid: 2, startPeriod: '2026-09', tarjeta: true, card: 'Leandro' },
    ];

    it('should subtract the estimated statement of each card in a future month (consumos del mes anterior)', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 9, 30, 12));
      try {
        (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue(leandroRecs);

        const pr = await service.getMonthProjection(userId, '2026-12');

        expect(pr.resumenesEstimados).toEqual([
          expect.objectContaining({
            card: 'Leandro',
            total: 150573.71 + 192966.66,
            items: expect.arrayContaining([
              expect.objectContaining({ description: 'Trimetra3d (cuota 3/3)' }),
              expect.objectContaining({ description: 'Seguro La Meridional' }),
            ]),
          }),
        ]);
        expect(pr.disponibleProyectado).toBeCloseTo(-(150573.71 + 192966.66), 2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should not estimate a card whose statement payment is already loaded in that month', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 9, 30, 12));
      try {
        (prisma.expense.findMany as jest.Mock).mockImplementation(({ where }) =>
          where.source === 'tarjeta-pendiente'
            ? Promise.resolve([])
            : Promise.resolve([
                { ...mockExpense, id: 'st', date: '2026-12-11', amount: 400000, source: 'resumen-tarjeta', card: 'leandro' },
              ]),
        );
        (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue(leandroRecs);

        const pr = await service.getMonthProjection(userId, '2026-12');

        expect(pr.resumenesEstimados).toEqual([]);
        expect(pr.disponibleProyectado).toBe(-400000);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should not estimate statements for the current month', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 9, 30, 12));
      try {
        (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue(leandroRecs);

        const pr = await service.getMonthProjection(userId, '2026-10');

        expect(pr.resumenesEstimados).toEqual([]);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('getCardDetail', () => {
    it('should group items, pending debt, paid statements and paid history of a card', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 9, 30, 12));
      try {
        (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
          { ...mockRecurring, id: 'r-tri', description: 'Trimetra3d', amount: 192966.66, totalInstallments: 3, installmentsPaid: 2, startPeriod: '2026-09', tarjeta: true, card: 'Leandro' },
          { ...mockRecurring, id: 'r-seg', description: 'Seguro', amount: 150000, tarjeta: true, card: 'leandro' },
          { ...mockRecurring, id: 'r-otra', description: 'Netflix', tarjeta: true, card: null },
        ]);
        (prisma.expense.findMany as jest.Mock).mockImplementation(({ where }) => {
          if (where.source === 'tarjeta-pendiente')
            return Promise.resolve([
              { id: 'b1', date: '2026-10-07', amount: 40000, description: 'Kwid', card: 'Leandro' },
              { id: 'b2', date: '2026-10-08', amount: 1, description: 'x', card: null },
            ]);
          if (where.source === 'resumen-tarjeta')
            return Promise.resolve([
              { id: 'st1', date: '2026-10-11', amount: 300000, description: 'Resumen Leandro', card: 'Leandro' },
            ]);
          // historial de los recurrentes
          return Promise.resolve([
            { id: 'h1', amount: 150000, recurringExpenseId: 'r-seg' },
            { id: 'h2', amount: 150000, recurringExpenseId: 'r-seg' },
          ]);
        });

        const d = await service.getCardDetail(userId, 'Leandro');

        expect(d.label).toBe('Leandro');
        expect(d.items.map((i) => i.id)).toEqual(['r-tri', 'r-seg']);
        const tri = d.items.find((i) => i.id === 'r-tri')!;
        expect(tri.cuotasRestantes).toBe(1);
        expect(tri.endPeriod).toBe('2026-11');
        expect(tri.pagado).toBeCloseTo(192966.66 * 2, 2);
        expect(d.items.find((i) => i.id === 'r-seg')!.pagado).toBe(300000);
        expect(d.pendiente.total).toBe(40000);
        expect(d.resumenesPagados).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('recurrentes en USD e inversión 3D', () => {
    it('should create a USD recurring with its ARS equivalent and a goal link', async () => {
      (prisma.recurringExpense.create as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve({ id: 'r-usd', ...data }),
      );

      await service.createRecurring(userId, {
        description: 'Google One',
        amountUsd: 19.99,
        exchangeRate: 1500,
        dayOfMonth: 21,
        tarjeta: true,
        goalId: 'goal-1',
      });

      expect(prisma.recurringExpense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 29985,
            originalAmount: 19.99,
            originalCurrency: 'USD',
            exchangeRate: 1500,
            goalId: 'goal-1',
          }),
        }),
      );
    });

    it('should copy currency and goal to the posted expense', async () => {
      (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
        {
          ...mockRecurring,
          id: 'r-a1',
          description: 'Bambu A1',
          amount: 250000,
          totalInstallments: 3,
          installmentsPaid: 0,
          startPeriod: '2026-11',
          goalId: 'goal-1',
          originalAmount: null,
          originalCurrency: null,
          exchangeRate: null,
        },
      ]);
      (prisma.expense.create as jest.Mock).mockResolvedValue({});
      (prisma.recurringExpense.update as jest.Mock).mockResolvedValue({});

      await service.postDueRecurringExpenses(new Date(2026, 10, 10));

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: 'Bambu A1 (cuota 1/3)',
          goalId: 'goal-1',
        }),
      });
    });
  });

  describe('getCardPending', () => {
    it('should list the unpaid card consumptions of every card, any date', async () => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
      await service.getCardPending(userId);
      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, source: 'tarjeta-pendiente' },
        }),
      );
    });
  });

  // ── v2: tarjetas con ciclo de cierre y vencimiento ────────

  describe('upsertCard', () => {
    it('should create a card config with its cycle', async () => {
      (prisma.creditCard.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.creditCard.create as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve({ id: 'cc-1', ...data }),
      );

      await service.upsertCard(userId, {
        name: 'Leandro',
        label: 'Hermano (Leandro) – adicional Visa Santander 7809',
        kind: 'adicional',
        payee: 'Leandro',
        closingDay: 29,
        dueDay: 11,
      });

      expect(prisma.creditCard.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          name: 'Leandro',
          isOwn: false,
          closingDay: 29,
          dueDay: 11,
        }),
      });
    });

    it('should update the own card when it already exists (una sola propia)', async () => {
      (prisma.creditCard.findFirst as jest.Mock).mockResolvedValue({ id: 'cc-own', isOwn: true });
      (prisma.creditCard.update as jest.Mock).mockResolvedValue({});

      await service.upsertCard(userId, { name: 'Visa 4112', isOwn: true, closingDay: 29, dueDay: 11 });

      expect(prisma.creditCard.findFirst).toHaveBeenCalledWith({ where: { userId, isOwn: true } });
      expect(prisma.creditCard.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cc-own' } }),
      );
    });

    it('should reject invalid days', async () => {
      await expect(
        service.upsertCard(userId, { name: 'X', closingDay: 0, dueDay: 11 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMonthProjection con ciclos configurados', () => {
    const leandroCfg = { id: 'cc-l', userId, name: 'Leandro', isOwn: false, label: 'Hermano (Leandro)', kind: 'adicional', payee: 'Leandro', closingDay: 29, dueDay: 11, variableEstimate: null };
    const visaCfg = { id: 'cc-v', userId, name: 'Visa 4112', isOwn: true, label: null, kind: 'propia', payee: 'Santander', closingDay: 29, dueDay: 11, variableEstimate: 75000 };

    const mockExpenses = (buffer: any[], month: any[] = []) =>
      (prisma.expense.findMany as jest.Mock).mockImplementation(({ where }) =>
        Promise.resolve(where.source === 'tarjeta-pendiente' ? buffer : month),
      );

    it('should count the cycle due this month in the current month while it is not due yet', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 10, 5, 12)); // 5/11
      try {
        (prisma.creditCard.findMany as jest.Mock).mockResolvedValue([leandroCfg]);
        mockExpenses([
          // cierra 29/10 → vence 11/11
          { id: 'b1', date: '2026-10-15', amount: 19138, description: 'Mutual', card: 'Leandro', recurringExpenseId: null },
          // 30/10 → ya es del ciclo que vence en diciembre
          { id: 'b2', date: '2026-10-30', amount: 5000, description: 'Nafta', card: 'Leandro', recurringExpenseId: null },
        ]);
        (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([]);

        const pr = await service.getMonthProjection(userId, '2026-11');

        expect(pr.resumenesEstimados).toEqual([
          expect.objectContaining({
            card: 'Leandro',
            label: 'Hermano (Leandro)',
            due: '2026-11-11',
            total: 19138,
          }),
        ]);
        expect(pr.disponibleProyectado).toBe(-19138);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should not count a cycle of the current month that is already due', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 10, 12, 12)); // 12/11
      try {
        (prisma.creditCard.findMany as jest.Mock).mockResolvedValue([leandroCfg]);
        mockExpenses([
          { id: 'b1', date: '2026-10-15', amount: 19138, description: 'Mutual', card: 'Leandro', recurringExpenseId: null },
        ]);
        (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([]);

        const pr = await service.getMonthProjection(userId, '2026-11');

        expect(pr.resumenesEstimados).toEqual([]);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should use the exact cycle (30/10 al 29/11) for a future month, with cuotas and the variable estimate', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 9, 30, 12)); // 30/10
      try {
        (prisma.creditCard.findMany as jest.Mock).mockResolvedValue([visaCfg]);
        mockExpenses([
          { id: 'n1', date: '2026-10-30', amount: 20000, description: 'Nafta', card: null, recurringExpenseId: null },
          { id: 'n0', date: '2026-10-29', amount: 999, description: 'Del ciclo anterior', card: null, recurringExpenseId: null },
        ]);
        (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
          { ...mockRecurring, id: 'r-net', description: 'Netflix', amount: 25398, dayOfMonth: 14, tarjeta: true, card: null, lastPostedPeriod: null },
          // día 30: el de octubre ya cae en este ciclo; el de noviembre (30/11) en el siguiente
          { ...mockRecurring, id: 'r-30', description: 'Gym', amount: 1000, dayOfMonth: 30, tarjeta: true, card: null, lastPostedPeriod: '2026-09' },
        ]);

        const pr = await service.getMonthProjection(userId, '2026-12');
        const visa = pr.resumenesEstimados[0];

        expect(visa.label).toBe('Visa 4112');
        expect(visa.due).toBe('2026-12-11');
        expect(visa.items.map((i) => i.description).sort()).toEqual(
          ['Consumos variables estimados', 'Gym', 'Nafta', 'Netflix'].sort(),
        );
        // 20.000 nafta real + 55.000 que falta para el estimado de 75.000
        expect(visa.items.find((i) => i.description === 'Consumos variables estimados')!.amount).toBe(55000);
        expect(visa.total).toBe(20000 + 55000 + 25398 + 1000);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('payCardStatement con ciclo configurado', () => {
    it('should default the payment date and closing to the next cycle of the card', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 9, 30, 12)); // 30/10
      try {
        (prisma.creditCard.findMany as jest.Mock).mockResolvedValue([
          { id: 'cc-l', name: 'Leandro', isOwn: false, closingDay: 29, dueDay: 11 },
        ]);
        (prisma.expense.findMany as jest.Mock).mockResolvedValue([
          { id: 'b1', date: '2026-10-29', amount: 100, description: 'a', card: 'Leandro' },
          { id: 'b2', date: '2026-10-30', amount: 200, description: 'b', card: 'Leandro' },
        ]);
        (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.expense.create as jest.Mock).mockImplementation(({ data }) =>
          Promise.resolve({ id: 'st-1', ...data }),
        );
        (prisma.expense.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

        const res = await service.payCardStatement(userId, { card: 'Leandro', amount: 561011.7 });

        expect(prisma.expense.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ date: '2026-11-11' }) }),
        );
        expect(res.settled.map((e) => e.id)).toEqual(['b1']);
        expect(res.remaining.map((e) => e.id)).toEqual(['b2']);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('getCardDetail con ciclos', () => {
    it('should split statement to pay, open cycle (ARS + USD) and overdue unsettled items', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 9, 30, 12)); // 30/10
      try {
        (prisma.creditCard.findMany as jest.Mock).mockResolvedValue([
          { id: 'cc-v', name: 'Visa 4112', isOwn: true, label: null, kind: 'propia', payee: null, closingDay: 29, dueDay: 11, variableEstimate: null },
        ]);
        (prisma.recurringExpense.findMany as jest.Mock).mockResolvedValue([
          { ...mockRecurring, id: 'r-g1', description: 'Google One', amount: 29985, originalAmount: 19.99, originalCurrency: 'USD', exchangeRate: 1500, dayOfMonth: 21, tarjeta: true, card: null, lastPostedPeriod: '2026-10' },
        ]);
        (prisma.expense.findMany as jest.Mock).mockImplementation(({ where }) => {
          if (where.source === 'tarjeta-pendiente')
            return Promise.resolve([
              { id: 'old', date: '2026-08-05', amount: 10499.83, description: 'Zapatillas 4/6', card: null, recurringExpenseId: null },
              { id: 'g-oct', date: '2026-10-21', amount: 29985, originalAmount: 19.99, originalCurrency: 'USD', description: 'Google One', card: null, recurringExpenseId: 'r-g1' },
              { id: 'naf', date: '2026-10-30', amount: 75000, description: 'Nafta', card: null, recurringExpenseId: null },
            ]);
          return Promise.resolve([]);
        });

        const d = await service.getCardDetail(userId, null);

        expect(d.label).toBe('Visa 4112');
        expect(d.aPagar!.cycle.due).toBe('2026-11-11');
        expect(d.aPagar!.items).toEqual([
          expect.objectContaining({ id: 'g-oct', tipo: 'fijo' }),
        ]);
        expect(d.aPagar!.totalUsd).toBeCloseTo(19.99, 2);
        expect(d.cicloAbierto!.cycle.due).toBe('2026-12-11');
        // nafta ya cargada + Google One de noviembre que todavía no se posteó
        expect(d.cicloAbierto!.items.map((i) => i.description).sort()).toEqual(['Google One', 'Nafta']);
        expect(d.vencidosSinSaldar.map((e) => e.id)).toEqual(['old']);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
