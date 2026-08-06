import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../config/prisma.service';
import { getLocalDateString } from '../../common/utils/date.utils';

export interface CreateExpenseDto {
  date: string; // YYYY-MM-DD
  amount: number;
  description: string;
  categoryId?: string | null;
  goalId?: string | null; // inversión para un objetivo (ej: filamento 3D)
}

export interface UpdateExpenseDto {
  date?: string;
  amount?: number;
  description?: string;
  categoryId?: string | null;
  goalId?: string | null;
}

export interface IncomeDto {
  date?: string;
  description?: string;
  amount?: number;
  cost?: number; // porción que recupera inversión; ganancia = amount - cost
  source?: string; // 3d | sueldo | devolucion | venta | otro
  status?: 'received' | 'pending'; // pending = por cobrar (no suma al balance)
  goalId?: string | null;
  notes?: string | null;
}

export interface CategoryDto {
  name?: string;
  icon?: string | null;
  color?: string | null;
  monthlyBudget?: number | null;
}

export interface RecurringDto {
  description?: string;
  amount?: number;
  categoryId?: string | null;
  dayOfMonth?: number;
  kind?: 'recurring' | 'subscription';
  active?: boolean;
  totalInstallments?: number | null; // cantidad de cuotas (null = sin fin)
  installmentsPaid?: number; // cuotas ya pagadas (override explícito)
  startPeriod?: string | null; // YYYY-MM de la primera cuota (puede ser pasado)
}

/** Última fecha válida del mes YYYY-MM (para el filtro lte). */
function monthRange(month: string): { gte: string; lte: string } {
  return { gte: `${month}-01`, lte: `${month}-31` };
}

function periodOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Meses de b - a (ambos YYYY-MM). Positivo si b es posterior. */
function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return periodOf(d);
}

/**
 * Mes (YYYY-MM) de la última cuota de un recurrente, o null si no tiene fin
 * o ya terminó. Con startPeriod es exacto; sin él estima desde el contador.
 */
export function recurringEndPeriod(
  rec: {
    totalInstallments: number | null;
    installmentsPaid: number;
    startPeriod: string | null;
    lastPostedPeriod: string | null;
  },
  now: Date = new Date(),
): string | null {
  if (!rec.totalInstallments) return null;
  const remaining = rec.totalInstallments - rec.installmentsPaid;
  if (remaining <= 0) return null;
  if (rec.startPeriod) {
    return addMonths(rec.startPeriod, rec.totalInstallments - 1);
  }
  const current = periodOf(now);
  // Si la de este mes ya se posteó, la próxima cuota es el mes que viene
  const monthsAhead =
    rec.lastPostedPeriod === current ? remaining : remaining - 1;
  return addMonths(current, monthsAhead);
}

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(private prisma: PrismaService) {}

  // ── Gastos ────────────────────────────────────────────────

  async getExpenses(userId: string, month: string) {
    return this.prisma.expense.findMany({
      where: { userId, date: monthRange(month) },
      include: { category: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createExpense(userId: string, dto: CreateExpenseDto) {
    if (!dto.amount || dto.amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('Falta la descripción del gasto');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.date || '')) {
      throw new BadRequestException('Fecha inválida (YYYY-MM-DD)');
    }
    return this.prisma.expense.create({
      data: {
        userId,
        date: dto.date,
        amount: dto.amount,
        description: dto.description.trim(),
        categoryId: dto.categoryId || null,
        goalId: dto.goalId || null,
        source: 'manual',
      },
      include: { category: true },
    });
  }

  async updateExpense(userId: string, id: string, dto: UpdateExpenseDto) {
    const existing = await this.prisma.expense.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Gasto no encontrado');
    if (dto.amount !== undefined && dto.amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }
    return this.prisma.expense.update({
      where: { id },
      data: {
        date: dto.date,
        amount: dto.amount,
        description: dto.description?.trim(),
        categoryId: dto.categoryId === undefined ? undefined : dto.categoryId,
        goalId: dto.goalId === undefined ? undefined : dto.goalId,
      },
      include: { category: true },
    });
  }

  async deleteExpense(userId: string, id: string) {
    const existing = await this.prisma.expense.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Gasto no encontrado');
    await this.prisma.expense.delete({ where: { id } });
    return true;
  }

  // ── Categorías ────────────────────────────────────────────

  async getCategories(userId: string) {
    return this.prisma.expenseCategory.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(userId: string, dto: CategoryDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Falta el nombre de la categoría');
    const dup = await this.prisma.expenseCategory.findFirst({
      where: { userId, name: { equals: name } },
    });
    if (dup) {
      throw new BadRequestException(`Ya existe la categoría "${dup.name}"`);
    }
    return this.prisma.expenseCategory.create({
      data: {
        userId,
        name,
        icon: dto.icon || null,
        color: dto.color || null,
        monthlyBudget: dto.monthlyBudget ?? null,
      },
    });
  }

  async updateCategory(userId: string, id: string, dto: CategoryDto) {
    const existing = await this.prisma.expenseCategory.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Categoría no encontrada');
    return this.prisma.expenseCategory.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        icon: dto.icon,
        color: dto.color,
        monthlyBudget: dto.monthlyBudget,
      },
    });
  }

  async deleteCategory(userId: string, id: string) {
    const existing = await this.prisma.expenseCategory.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Categoría no encontrada');
    // Los gastos quedan sin categoría (onDelete: SetNull)
    await this.prisma.expenseCategory.delete({ where: { id } });
    return true;
  }

  // ── Recurrentes / suscripciones ───────────────────────────

  async getRecurring(userId: string) {
    return this.prisma.recurringExpense.findMany({
      where: { userId },
      include: { category: true },
      orderBy: [{ active: 'desc' }, { dayOfMonth: 'asc' }],
    });
  }

  async createRecurring(userId: string, dto: RecurringDto) {
    if (!dto.description?.trim()) {
      throw new BadRequestException('Falta la descripción');
    }
    if (!dto.amount || dto.amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }
    if (dto.totalInstallments !== undefined && dto.totalInstallments !== null) {
      if (!Number.isInteger(dto.totalInstallments) || dto.totalInstallments < 1) {
        throw new BadRequestException('Las cuotas deben ser un entero >= 1');
      }
    }
    if (dto.startPeriod && !/^\d{4}-\d{2}$/.test(dto.startPeriod)) {
      throw new BadRequestException('Primer mes inválido (YYYY-MM)');
    }
    // 1-28 para que exista en todos los meses
    const day = Math.min(Math.max(dto.dayOfMonth || 1, 1), 28);
    const total = dto.totalInstallments ?? null;

    // Cuotas ya pagadas: explícito, o derivado de un primer mes en el pasado
    // (los meses ANTERIORES al actual cuentan pagados; la del mes en curso la
    // postea el cron normal así aparece como gasto del mes).
    let paid = dto.installmentsPaid;
    if (paid === undefined) {
      paid = dto.startPeriod
        ? Math.max(0, monthsBetween(dto.startPeriod, periodOf(new Date())))
        : 0;
    }
    if (paid < 0) throw new BadRequestException('Cuotas pagadas inválidas');
    if (total !== null) paid = Math.min(paid, total);

    return this.prisma.recurringExpense.create({
      data: {
        userId,
        description: dto.description.trim(),
        amount: dto.amount,
        categoryId: dto.categoryId || null,
        dayOfMonth: day,
        kind: dto.kind === 'subscription' ? 'subscription' : 'recurring',
        totalInstallments: total,
        installmentsPaid: paid,
        startPeriod: dto.startPeriod || null,
        active: total === null || paid < total,
      },
      include: { category: true },
    });
  }

  async updateRecurring(userId: string, id: string, dto: RecurringDto) {
    const existing = await this.prisma.recurringExpense.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Pago recurrente no encontrado');
    return this.prisma.recurringExpense.update({
      where: { id },
      data: {
        description: dto.description?.trim(),
        amount: dto.amount,
        categoryId: dto.categoryId === undefined ? undefined : dto.categoryId,
        dayOfMonth:
          dto.dayOfMonth !== undefined
            ? Math.min(Math.max(dto.dayOfMonth, 1), 28)
            : undefined,
        kind: dto.kind,
        active: dto.active,
        totalInstallments:
          dto.totalInstallments === undefined
            ? undefined
            : dto.totalInstallments,
        installmentsPaid: dto.installmentsPaid,
        startPeriod:
          dto.startPeriod === undefined ? undefined : dto.startPeriod,
      },
      include: { category: true },
    });
  }

  async deleteRecurring(userId: string, id: string) {
    const existing = await this.prisma.recurringExpense.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Pago recurrente no encontrado');
    await this.prisma.recurringExpense.delete({ where: { id } });
    return true;
  }

  /**
   * Genera los gastos del período para los recurrentes vencidos (cron diario).
   * Idempotente: cada recurrente se postea 1 vez por mes (lastPostedPeriod).
   */
  @Cron('5 0 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async postDueRecurringExpensesCron() {
    try {
      const posted = await this.postDueRecurringExpenses(new Date());
      if (posted > 0) {
        this.logger.log(`Recurrentes posteados: ${posted}`);
      }
    } catch (error) {
      this.logger.error('Error posteando gastos recurrentes:', error);
    }
  }

  async postDueRecurringExpenses(now: Date): Promise<number> {
    const period = periodOf(now);
    const day = now.getDate();

    const due = await this.prisma.recurringExpense.findMany({
      where: { active: true },
    });

    let posted = 0;
    for (const rec of due) {
      if (rec.dayOfMonth > day) continue;
      if (rec.lastPostedPeriod === period) continue;
      // Cuotas que arrancan en un mes futuro: todavía no se pagan
      if (rec.startPeriod && rec.startPeriod > period) continue;

      const cuota = rec.totalInstallments ? rec.installmentsPaid + 1 : null;
      await this.prisma.expense.create({
        data: {
          userId: rec.userId,
          date: `${period}-${String(rec.dayOfMonth).padStart(2, '0')}`,
          amount: rec.amount,
          description:
            rec.description +
            (cuota ? ` (cuota ${cuota}/${rec.totalInstallments})` : ''),
          categoryId: rec.categoryId,
          source: 'recurring',
          recurringExpenseId: rec.id,
        },
      });
      await this.prisma.recurringExpense.update({
        where: { id: rec.id },
        data: {
          lastPostedPeriod: period,
          // Al pagar la última cuota el recurrente se apaga solo
          ...(cuota
            ? {
                installmentsPaid: cuota,
                active: cuota < (rec.totalInstallments as number),
              }
            : {}),
        },
      });
      posted++;
    }
    return posted;
  }

  // ── Ingresos (ventas 3D u otros) ──────────────────────────

  async getIncomes(userId: string, month?: string) {
    return this.prisma.income.findMany({
      where: {
        userId,
        ...(month ? { date: monthRange(month) } : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createIncome(userId: string, dto: IncomeDto) {
    if (!dto.amount || dto.amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }
    const cost = dto.cost ?? 0;
    if (cost < 0 || cost > dto.amount) {
      throw new BadRequestException(
        'El costo no puede ser negativo ni mayor al monto cobrado',
      );
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('Falta la descripción del ingreso');
    }
    if (dto.status && dto.status !== 'received' && dto.status !== 'pending') {
      throw new BadRequestException('Estado inválido (received | pending)');
    }
    return this.prisma.income.create({
      data: {
        userId,
        date: dto.date || getLocalDateString(),
        description: dto.description.trim(),
        amount: dto.amount,
        cost,
        source: dto.source || '3d',
        status: dto.status || 'received',
        goalId: dto.goalId || null,
        notes: dto.notes || null,
      },
    });
  }

  /** Marca un ingreso pendiente como cobrado, fechándolo en el día del cobro. */
  async markIncomeReceived(userId: string, id: string, date?: string) {
    const existing = await this.prisma.income.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Ingreso no encontrado');
    if (existing.status !== 'pending') {
      throw new BadRequestException('El ingreso ya está cobrado');
    }
    return this.prisma.income.update({
      where: { id },
      data: { status: 'received', date: date || getLocalDateString() },
    });
  }

  async getPendingIncomes(userId: string) {
    return this.prisma.income.findMany({
      where: { userId, status: 'pending' },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async updateIncome(userId: string, id: string, dto: IncomeDto) {
    const existing = await this.prisma.income.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Ingreso no encontrado');
    const amount = dto.amount ?? existing.amount;
    const cost = dto.cost ?? existing.cost;
    if (amount <= 0 || cost < 0 || cost > amount) {
      throw new BadRequestException('Monto/costo inválidos');
    }
    return this.prisma.income.update({
      where: { id },
      data: {
        date: dto.date,
        description: dto.description?.trim(),
        amount: dto.amount,
        cost: dto.cost,
        source: dto.source,
        goalId: dto.goalId === undefined ? undefined : dto.goalId,
        notes: dto.notes === undefined ? undefined : dto.notes,
      },
    });
  }

  async deleteIncome(userId: string, id: string) {
    const existing = await this.prisma.income.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Ingreso no encontrado');
    await this.prisma.income.delete({ where: { id } });
    return true;
  }

  /**
   * Balance del negocio 3D (espejo del sheet "Seguimiento privado"):
   * inversión (gastos linkeados a un objetivo) vs ganancia de ingresos.
   */
  async getBusinessSummary(userId: string) {
    const [investments, incomes] = await Promise.all([
      this.prisma.expense.findMany({
        where: { userId, goalId: { not: null } },
      }),
      // Solo ventas 3D ya cobradas: el sueldo u otros ingresos no son del negocio
      this.prisma.income.findMany({
        where: { userId, source: '3d', status: 'received' },
      }),
    ]);

    const invested = investments.reduce((a, e) => a + e.amount, 0);
    const incomeTotal = incomes.reduce((a, i) => a + i.amount, 0);
    const costRecovered = incomes.reduce((a, i) => a + i.cost, 0);
    const profit = incomeTotal - costRecovered;

    return {
      invested,
      investmentsCount: investments.length,
      incomeTotal,
      costRecovered,
      profit,
      balance: profit - invested,
      toRecover: Math.max(0, invested - profit),
      incomesCount: incomes.length,
    };
  }

  /**
   * Balance del mes: ingresos cobrados vs gastos, con devoluciones netas
   * y lo pendiente de cobro (cualquier fecha) aparte.
   */
  async getMonthlyBalance(userId: string, month: string) {
    const [expenses, incomes, pending] = await Promise.all([
      this.prisma.expense.findMany({
        where: { userId, date: monthRange(month) },
      }),
      this.prisma.income.findMany({
        where: { userId, status: 'received', date: monthRange(month) },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      this.getPendingIncomes(userId),
    ]);

    const expensesTotal = expenses.reduce((a, e) => a + e.amount, 0);
    const refunds = incomes.filter((i) => i.source === 'devolucion');
    const refundsTotal = refunds.reduce((a, i) => a + i.amount, 0);
    const earned = incomes.filter((i) => i.source !== 'devolucion');
    const incomesTotal = earned.reduce((a, i) => a + i.amount, 0);

    const bySourceMap = new Map<string, { amount: number; count: number }>();
    for (const i of earned) {
      const cur = bySourceMap.get(i.source) || { amount: 0, count: 0 };
      cur.amount += i.amount;
      cur.count++;
      bySourceMap.set(i.source, cur);
    }

    return {
      month,
      expensesTotal,
      incomesTotal,
      refundsTotal,
      netExpenses: expensesTotal - refundsTotal,
      balance: incomesTotal + refundsTotal - expensesTotal,
      bySource: [...bySourceMap.entries()]
        .map(([source, v]) => ({ source, ...v }))
        .sort((a, b) => b.amount - a.amount),
      incomes,
      pendingTotal: pending.reduce((a, i) => a + i.amount, 0),
      pending,
    };
  }

  // ── Resumen / insights ────────────────────────────────────

  async getSummary(userId: string, month: string) {
    const [y, m] = month.split('-').map(Number);
    const prev = new Date(y, m - 2, 1); // mes anterior
    const prevMonth = periodOf(prev);

    const [expenses, prevExpenses, categories, recurring] = await Promise.all([
      this.prisma.expense.findMany({
        where: { userId, date: monthRange(month) },
      }),
      this.prisma.expense.findMany({
        where: { userId, date: monthRange(prevMonth) },
      }),
      this.prisma.expenseCategory.findMany({ where: { userId } }),
      this.prisma.recurringExpense.findMany({
        where: { userId, active: true },
      }),
    ]);

    const total = expenses.reduce((a, e) => a + e.amount, 0);
    const prevMonthTotal = prevExpenses.reduce((a, e) => a + e.amount, 0);

    const byCategory = categories
      .map((c) => {
        const amount = expenses
          .filter((e) => e.categoryId === c.id)
          .reduce((a, e) => a + e.amount, 0);
        return {
          categoryId: c.id,
          name: c.name,
          icon: c.icon,
          color: c.color,
          amount,
          budget: c.monthlyBudget,
          budgetPct:
            c.monthlyBudget && c.monthlyBudget > 0
              ? Math.round((amount / c.monthlyBudget) * 100)
              : null,
        };
      })
      .filter((c) => c.amount > 0 || c.budget)
      .sort((a, b) => b.amount - a.amount);

    const uncategorized = expenses
      .filter((e) => !e.categoryId)
      .reduce((a, e) => a + e.amount, 0);

    const overBudget = byCategory
      .filter((c) => c.budgetPct !== null && c.budgetPct > 100)
      .map((c) => c.name);

    const subscriptionsMonthly = recurring
      .filter((r) => r.kind === 'subscription')
      .reduce((a, r) => a + r.amount, 0);

    const topExpenses = [...expenses]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        date: e.date,
        description: e.description,
        amount: e.amount,
      }));

    return {
      month,
      total,
      prevMonthTotal,
      deltaPct:
        prevMonthTotal > 0
          ? Math.round(((total - prevMonthTotal) / prevMonthTotal) * 100)
          : null,
      byCategory,
      uncategorized,
      overBudget,
      subscriptionsMonthly,
      recurringMonthly: recurring.reduce((a, r) => a + r.amount, 0),
      topExpenses,
    };
  }
}
