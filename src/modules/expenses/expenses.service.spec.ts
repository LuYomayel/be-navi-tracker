import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpensesService, recurringEndPeriod } from './expenses.service';
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
        { ...cuotaRec, installmentsPaid: 11 },
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

  describe('getMonthlyBalance', () => {
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
});
