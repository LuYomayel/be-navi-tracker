import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../config/prisma.service';
import { ExpenseCategorizerService } from './expense-categorizer.service';
import { getLocalDateString } from '../../common/utils/date.utils';
import {
  CardCycle,
  CardCycleConfig,
  DEFAULT_CYCLE,
  cycleDueIn,
  dayIn,
  nextCycle,
  nextDueCycle,
} from './card-cycle';

export interface CreateExpenseDto {
  date: string; // YYYY-MM-DD
  amount?: number; // ARS (si viene amountUsd se calcula)
  amountUsd?: number; // gasto en dólares: amount = amountUsd * exchangeRate
  exchangeRate?: number;
  description: string;
  categoryId?: string | null;
  goalId?: string | null; // inversión para un objetivo (ej: filamento 3D)
  tarjeta?: boolean; // consumo con tarjeta de crédito → buffer del próximo resumen
  card?: string | null; // qué tarjeta: null/vacío = la Visa propia, texto = otra (ej "Hermano")
}

/** Etiqueta de la tarjeta propia (card = null en la DB). */
export const DEFAULT_CARD_LABEL = 'Visa';

/**
 * Sources que NO son gasto del mes: el buffer de crédito (deuda del próximo
 * resumen) y el detalle de un resumen ya pagado (el gasto real es el
 * "resumen-tarjeta", sumarlos contaría doble).
 */
export const OFF_BALANCE_SOURCES = ['tarjeta-pendiente', 'tarjeta-saldada'];

/** Misma tarjeta: null = la propia; los nombres se comparan sin mayúsculas. */
function sameCard(a: string | null, b: string | null): boolean {
  if (!a || !b) return !a && !b;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Valida un monto en USD + cotización y devuelve los campos a guardar. */
function usdFields(amountUsd: number, exchangeRate: number | undefined) {
  if (!(amountUsd > 0)) {
    throw new BadRequestException('El monto en USD debe ser mayor a 0');
  }
  if (!exchangeRate || exchangeRate <= 0) {
    throw new BadRequestException(
      'Para un gasto en USD falta la cotización (ARS por dólar)',
    );
  }
  return {
    amount: round2(amountUsd * exchangeRate),
    originalAmount: amountUsd,
    originalCurrency: 'USD',
    exchangeRate,
  };
}

/** Consumos de crédito pendientes agrupados por tarjeta (la propia primero). */
function groupByCard(
  rows: {
    id: string;
    date: string;
    amount: number;
    description: string;
    card: string | null;
    pending?: boolean;
  }[],
) {
  const byCard = new Map<string | null, typeof rows>();
  for (const r of rows) {
    const key = r.card ?? null;
    if (!byCard.has(key)) byCard.set(key, []);
    byCard.get(key)!.push(r);
  }
  return [...byCard.entries()]
    .sort(([a], [b]) =>
      a === null ? -1 : b === null ? 1 : a.localeCompare(b),
    )
    .map(([card, items]) => ({
      card,
      label: card ?? DEFAULT_CARD_LABEL,
      total: items.reduce((s, e) => s + e.amount, 0),
      items: items.map((e) => ({
        id: e.id,
        date: e.date,
        amount: e.amount,
        description: e.description,
        pending: !!e.pending, // aún no consumido: lo postea el cron ese día
      })),
    }));
}

export interface UpdateExpenseDto {
  date?: string;
  amount?: number;
  amountUsd?: number; // pasa (o corrige) el gasto a dólares
  exchangeRate?: number; // sola: recalcula el ARS de un gasto que ya está en USD
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
  amountUsd?: number; // en dólares: amount = amountUsd * exchangeRate
  exchangeRate?: number;
  goalId?: string | null; // inversión (ej: impresora en cuotas → negocio 3D)
  categoryId?: string | null;
  dayOfMonth?: number;
  kind?: 'recurring' | 'subscription';
  active?: boolean;
  totalInstallments?: number | null; // cantidad de cuotas (null = sin fin)
  installmentsPaid?: number; // cuotas ya pagadas (override explícito)
  startPeriod?: string | null; // YYYY-MM de la primera cuota (puede ser pasado)
  tarjeta?: boolean; // se paga con tarjeta de crédito
  card?: string | null; // qué tarjeta: null = la Visa propia, texto = otra
  finished?: boolean; // terminado / pagado por adelantado: todas las cuotas pagas y se apaga
}

export interface CardConfigDto {
  name: string; // = Expense.card ("Leandro"); para la propia, el nombre que se muestra
  isOwn?: boolean; // la propia: matchea los consumos con card = null
  label?: string | null;
  kind?: string; // propia | adicional | acreedor
  payee?: string | null;
  closingDay: number;
  dueDay: number;
  variableEstimate?: number | null;
}

export interface CardRow {
  id: string;
  name: string;
  isOwn: boolean;
  label?: string | null;
  kind?: string;
  payee?: string | null;
  closingDay: number;
  dueDay: number;
  variableEstimate?: number | null;
}

/** Clave de una tarjeta configurada en Expense.card (la propia = null). */
const cardKey = (c: CardRow) => (c.isOwn ? null : c.name);

const cardLabel = (key: string | null, conf?: CardRow) =>
  conf?.label || (conf?.isOwn ? conf.name : null) || key || DEFAULT_CARD_LABEL;

/** Ítem de un ciclo: consumo anotado, cuota o fijo (cargado o por venir). */
export interface CycleItem {
  id: string;
  date: string;
  amount: number;
  description: string;
  card: string | null;
  pending: boolean; // todavía no está en el buffer: lo postea el cron
  tipo: 'consumo' | 'cuota' | 'fijo' | 'estimado';
  originalAmount?: number | null;
  originalCurrency?: string | null;
  exchangeRate?: number | null;
}

export interface CardStatementDto {
  card: string | null; // null = la Visa propia
  amount?: number; // parte en pesos del resumen
  amountUsd?: number; // parte en dólares
  exchangeRate?: number; // cotización de la parte en dólares
  date?: string; // día del pago (puede ser futuro); default = próximo vencimiento de la tarjeta
  closingDate?: string; // cierre: salda los consumos del buffer hasta esta fecha (default = date)
  description?: string;
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
 * ¿Le toca cobrarse al recurrente en el mes `period`, y qué cuota es?
 * Con startPeriod la cuota sale del calendario (cuota n = meses desde el
 * primero + 1), así una cuota ya pagada por adelantado (installmentsPaid >= n)
 * no se vuelve a cobrar. Sin startPeriod se cuenta desde el próximo mes sin
 * postear.
 */
export function installmentForPeriod(
  rec: {
    totalInstallments: number | null;
    installmentsPaid: number;
    startPeriod: string | null;
    lastPostedPeriod: string | null;
  },
  period: string,
  now: Date = new Date(),
): { due: boolean; cuota: number | null } {
  if (rec.startPeriod && rec.startPeriod > period) {
    return { due: false, cuota: null };
  }
  if (!rec.totalInstallments) return { due: true, cuota: null };
  let cuota: number;
  if (rec.startPeriod) {
    cuota = monthsBetween(rec.startPeriod, period) + 1;
  } else {
    const next = rec.lastPostedPeriod
      ? addMonths(rec.lastPostedPeriod, 1)
      : periodOf(now);
    const ahead = monthsBetween(next, period);
    if (ahead < 0) return { due: false, cuota: null };
    cuota = rec.installmentsPaid + 1 + ahead;
  }
  return {
    due: cuota > rec.installmentsPaid && cuota <= rec.totalInstallments,
    cuota,
  };
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

  constructor(
    private prisma: PrismaService,
    private categorizer: ExpenseCategorizerService,
  ) {}

  // ── Gastos ────────────────────────────────────────────────

  async getExpenses(userId: string, month: string) {
    return this.prisma.expense.findMany({
      where: {
        userId,
        date: monthRange(month),
        source: { notIn: OFF_BALANCE_SOURCES },
      },
      include: { category: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createExpense(userId: string, dto: CreateExpenseDto) {
    const usd =
      dto.amountUsd !== undefined
        ? usdFields(dto.amountUsd, dto.exchangeRate)
        : null;
    if (!usd && (!dto.amount || dto.amount <= 0)) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('Falta la descripción del gasto');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.date || '')) {
      throw new BadRequestException('Fecha inválida (YYYY-MM-DD)');
    }
    // Sin categoría explícita, el categorizador la sugiere (reglas →
    // historial → IA con umbral). Si duda, queda sin categoría.
    let categoryId = dto.categoryId || null;
    if (!categoryId) {
      const sug = await this.categorizer
        .categorize(userId, dto.description.trim())
        .catch(() => null);
      categoryId = sug?.categoryId || null;
    }
    const card = dto.card?.trim() || null;
    const esTarjeta = dto.tarjeta || !!card;
    return this.prisma.expense.create({
      data: {
        userId,
        date: dto.date,
        amount: dto.amount as number,
        ...(usd || {}),
        description: dto.description.trim(),
        categoryId,
        goalId: dto.goalId || null,
        // Consumo de crédito: va al buffer del próximo resumen, no al mes
        source: esTarjeta ? 'tarjeta-pendiente' : 'manual',
        card: esTarjeta ? card : null,
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
    // USD: monto nuevo en dólares, o solo la cotización de uno que ya lo es
    let usd: ReturnType<typeof usdFields> | null = null;
    if (dto.amountUsd !== undefined) {
      usd = usdFields(dto.amountUsd, dto.exchangeRate ?? existing.exchangeRate ?? undefined);
    } else if (dto.exchangeRate !== undefined) {
      if (existing.originalCurrency !== 'USD' || !existing.originalAmount) {
        throw new BadRequestException(
          'Ese gasto no está en dólares: pasá el monto en USD además de la cotización',
        );
      }
      usd = usdFields(existing.originalAmount, dto.exchangeRate);
    }
    // Monto en pesos explícito sobre un gasto en dólares: deja de serlo
    const currencyReset =
      !usd && dto.amount !== undefined && existing.originalCurrency
        ? { originalAmount: null, originalCurrency: null, exchangeRate: null }
        : {};
    return this.prisma.expense.update({
      where: { id },
      data: {
        ...currencyReset,
        ...(usd || {}),
        date: dto.date,
        amount: usd ? usd.amount : dto.amount,
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
    const usd =
      dto.amountUsd !== undefined
        ? usdFields(dto.amountUsd, dto.exchangeRate)
        : null;
    if (!usd && (!dto.amount || dto.amount <= 0)) {
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
        amount: dto.amount as number,
        ...(usd || {}),
        goalId: dto.goalId || null,
        categoryId: dto.categoryId || null,
        dayOfMonth: day,
        kind: dto.kind === 'subscription' ? 'subscription' : 'recurring',
        totalInstallments: total,
        installmentsPaid: paid,
        startPeriod: dto.startPeriod || null,
        active: total === null || paid < total,
        tarjeta: dto.tarjeta || !!dto.card?.trim(),
        card: dto.card?.trim() || null,
      },
      include: { category: true },
    });
  }

  async updateRecurring(userId: string, id: string, dto: RecurringDto) {
    const existing = await this.prisma.recurringExpense.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Pago recurrente no encontrado');
    const total =
      dto.totalInstallments === undefined
        ? existing.totalInstallments
        : dto.totalInstallments;
    let paid = dto.installmentsPaid;
    let active = dto.active;
    let usd: ReturnType<typeof usdFields> | null = null;
    if (dto.amountUsd !== undefined) {
      usd = usdFields(dto.amountUsd, dto.exchangeRate ?? existing.exchangeRate ?? undefined);
    } else if (dto.exchangeRate !== undefined && existing.originalAmount) {
      usd = usdFields(existing.originalAmount, dto.exchangeRate);
    }
    const currencyReset =
      !usd && dto.amount !== undefined && existing.originalCurrency
        ? { originalAmount: null, originalCurrency: null, exchangeRate: null }
        : {};
    if (dto.finished) {
      // Terminado o pagado por adelantado: no se cobra más
      active = false;
      if (total) paid = total;
    } else if (total && (paid ?? existing.installmentsPaid) >= total) {
      active = false;
    }
    return this.prisma.recurringExpense.update({
      where: { id },
      data: {
        ...currencyReset,
        ...(usd || {}),
        description: dto.description?.trim(),
        amount: usd ? usd.amount : dto.amount,
        goalId: dto.goalId === undefined ? undefined : dto.goalId,
        categoryId: dto.categoryId === undefined ? undefined : dto.categoryId,
        dayOfMonth:
          dto.dayOfMonth !== undefined
            ? Math.min(Math.max(dto.dayOfMonth, 1), 28)
            : undefined,
        kind: dto.kind,
        active,
        totalInstallments:
          dto.totalInstallments === undefined
            ? undefined
            : dto.totalInstallments,
        installmentsPaid: paid,
        startPeriod:
          dto.startPeriod === undefined ? undefined : dto.startPeriod,
        tarjeta:
          dto.tarjeta === undefined && dto.card === undefined
            ? undefined
            : dto.tarjeta || !!dto.card?.trim(),
        card:
          dto.card === undefined ? undefined : dto.card?.trim() || null,
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
      // Cuotas que arrancan en un mes futuro o ya pagadas por adelantado
      const { due: toca, cuota } = installmentForPeriod(rec, period, now);
      if (!toca) continue;

      await this.prisma.expense.create({
        data: {
          userId: rec.userId,
          date: `${period}-${String(rec.dayOfMonth).padStart(2, '0')}`,
          amount: rec.amount,
          description:
            rec.description +
            (cuota ? ` (cuota ${cuota}/${rec.totalInstallments})` : ''),
          categoryId: rec.categoryId,
          goalId: rec.goalId ?? null,
          ...(rec.originalCurrency
            ? {
                originalAmount: rec.originalAmount,
                originalCurrency: rec.originalCurrency,
                exchangeRate: rec.exchangeRate,
              }
            : {}),
          // Si se paga con crédito no es gasto del mes: queda como deuda del
          // próximo resumen de esa tarjeta.
          source: rec.tarjeta ? 'tarjeta-pendiente' : 'recurring',
          card: rec.tarjeta ? rec.card : null,
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
        where: {
          userId,
          date: monthRange(month),
          source: { notIn: OFF_BALANCE_SOURCES },
        },
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

  /**
   * Proyección del resto del mes: saldo de hoy − gastos ya agendados a futuro
   * − cuotas/recurrentes que todavía no se postearon + ingresos esperados
   * (pendientes con fecha en el mes). Responde "¿cuánta plata dispongo
   * realmente para lo que queda del mes?".
   */
  async getMonthProjection(userId: string, month: string) {
    const today = getLocalDateString();
    const [expenses, incomes, pendingIncomes, recurring, tarjetaPendiente, cards] = await Promise.all([
      this.prisma.expense.findMany({
        where: {
          userId,
          date: monthRange(month),
          source: { notIn: OFF_BALANCE_SOURCES },
        },
        orderBy: { date: 'asc' },
      }),
      this.prisma.income.findMany({
        where: { userId, status: 'received', date: monthRange(month) },
      }),
      this.prisma.income.findMany({
        where: { userId, status: 'pending', date: monthRange(month) },
        orderBy: { date: 'asc' },
      }),
      this.prisma.recurringExpense.findMany({ where: { userId, active: true } }),
      this.prisma.expense.findMany({
        where: { userId, source: 'tarjeta-pendiente' },
        orderBy: { date: 'asc' },
      }),
      this.prisma.creditCard.findMany({ where: { userId } }),
    ]);

    const ejecutados = expenses.filter((e) => e.date <= today);
    const futuros = expenses.filter((e) => e.date > today);
    const gastosEjecutados = ejecutados.reduce((a, e) => a + e.amount, 0);
    const gastosFuturosTotal = futuros.reduce((a, e) => a + e.amount, 0);
    const ingresosCobrados = incomes.reduce((a, i) => a + i.amount, 0);
    const ingresosEsperadosTotal = pendingIncomes.reduce(
      (a, i) => a + i.amount,
      0,
    );

    // Recurrentes que todavía no postearon su gasto de este mes
    const now = new Date();
    const porVenir = recurring
      .filter((r) => r.lastPostedPeriod !== month)
      .map((r) => ({ ...r, ...installmentForPeriod(r, month, now) }))
      .filter((r) => r.due);
    // Los que se pagan con crédito no salen de la plata del mes: son deuda
    // del próximo resumen de esa tarjeta.
    const recurrentesPorVenir = porVenir.filter((r) => !r.tarjeta);
    const recurrentesPorVenirTotal = recurrentesPorVenir.reduce(
      (a, r) => a + r.amount,
      0,
    );
    const recurrentesEnTarjeta = porVenir
      .filter((r) => r.tarjeta)
      .map((r) => ({
        id: r.id,
        date: `${month}-${String(r.dayOfMonth).padStart(2, '0')}`,
        amount: r.amount,
        description:
          r.description +
          (r.cuota ? ` (cuota ${r.cuota}/${r.totalInstallments})` : ''),
        card: r.card,
        pending: true, // todavía no lo consumió: lo postea el cron el día X
      }));

    const deudaTarjeta = [
      ...tarjetaPendiente.map((e) => ({
        id: e.id,
        date: e.date,
        amount: e.amount,
        description: e.description,
        card: e.card,
        pending: false,
      })),
      ...recurrentesEnTarjeta,
    ].sort((a, b) => a.date.localeCompare(b.date));

    // El resumen de cada tarjeta que vence este mes (su ciclo: consumos +
    // cuotas/fijos con tarjeta) sale de la plata del mes, salvo que el pago
    // ya esté cargado (gasto resumen-tarjeta).
    const resumenesEstimados = this.estimateStatements(
      month,
      today,
      tarjetaPendiente,
      recurring,
      expenses.filter((e) => e.source === 'resumen-tarjeta'),
      cards,
      now,
    );
    const resumenesEstimadosTotal = resumenesEstimados.reduce(
      (a, g) => a + g.total,
      0,
    );

    const saldoHoy = ingresosCobrados - gastosEjecutados;
    const disponibleProyectado =
      saldoHoy -
      gastosFuturosTotal -
      recurrentesPorVenirTotal -
      resumenesEstimadosTotal +
      ingresosEsperadosTotal;

    return {
      month,
      today,
      ingresosCobrados,
      gastosEjecutados,
      saldoHoy,
      gastosFuturos: futuros.map((e) => ({
        id: e.id,
        date: e.date,
        amount: e.amount,
        description: e.description,
      })),
      gastosFuturosTotal,
      recurrentesPorVenir: recurrentesPorVenir.map((r) => ({
        id: r.id,
        description: r.description,
        amount: r.amount,
        dayOfMonth: r.dayOfMonth,
        cuota: r.cuota ? `${r.cuota}/${r.totalInstallments}` : null,
      })),
      recurrentesPorVenirTotal,
      ingresosEsperados: pendingIncomes.map((i) => ({
        id: i.id,
        date: i.date,
        amount: i.amount,
        description: i.description,
      })),
      ingresosEsperadosTotal,
      disponibleProyectado,
      // Deuda de tarjeta: lo ya consumido + los recurrentes que todavía no
      // postearon pero se van a cobrar con esa tarjeta este mes.
      tarjetaPendiente: deudaTarjeta.map((e) => ({
        id: e.id,
        date: e.date,
        amount: e.amount,
        description: e.description,
        card: e.card,
        pending: e.pending,
      })),
      tarjetaPendienteTotal: deudaTarjeta.reduce((a, e) => a + e.amount, 0),
      tarjetaPendientePorTarjeta: groupByCard(deudaTarjeta),
      resumenesEstimados,
      resumenesEstimadosTotal,
    };
  }

  /** Config de ciclo de una tarjeta (o la default si no está configurada). */
  private cardConfig(cards: CardRow[], key: string | null) {
    const conf = cards.find((c) => sameCard(cardKey(c), key));
    const cfg: CardCycleConfig = conf
      ? { closingDay: conf.closingDay, dueDay: conf.dueDay }
      : DEFAULT_CYCLE;
    return { conf, cfg };
  }

  /**
   * Ítems de una tarjeta en un ciclo: lo anotado en el buffer entre el
   * inicio y el cierre + lo que los recurrentes con esa tarjeta van a cobrar
   * en ese rango y todavía no postearon. Con `variableEstimate`, completa los
   * consumos variables hasta ese monto.
   */
  private cycleItems(
    key: string | null,
    cyc: CardCycle,
    buffer: any[],
    recurring: any[],
    conf: CardRow | undefined,
    now: Date,
    withEstimate = true, // false si el pago del ciclo ya está cargado
  ): CycleItem[] {
    const recs = recurring.filter(
      (r) => r.tarjeta && r.active !== false && sameCard(r.card, key),
    );
    const items: CycleItem[] = buffer
      .filter(
        (e) =>
          sameCard(e.card, key) && e.date >= cyc.start && e.date <= cyc.closing,
      )
      .map((e) => {
        const rec = e.recurringExpenseId
          ? recurring.find((r) => r.id === e.recurringExpenseId)
          : null;
        return {
          id: e.id,
          date: e.date,
          amount: e.amount,
          description: e.description,
          card: e.card,
          pending: false,
          tipo: !e.recurringExpenseId
            ? 'consumo'
            : rec?.totalInstallments
              ? 'cuota'
              : 'fijo',
          originalAmount: e.originalAmount,
          originalCurrency: e.originalCurrency,
          exchangeRate: e.exchangeRate,
        };
      });
    const periods = [...new Set([cyc.start.slice(0, 7), cyc.closing.slice(0, 7)])];
    for (const r of recs) {
      for (const p of periods) {
        const date = dayIn(p, r.dayOfMonth);
        if (date < cyc.start || date > cyc.closing) continue;
        // Ya posteado → está en el buffer (o ya se pagó)
        if (r.lastPostedPeriod && r.lastPostedPeriod >= p) continue;
        const { due, cuota } = installmentForPeriod(r, p, now);
        if (!due) continue;
        items.push({
          id: r.id,
          date,
          amount: r.amount,
          description:
            r.description + (cuota ? ` (cuota ${cuota}/${r.totalInstallments})` : ''),
          card: r.card,
          pending: true,
          tipo: r.totalInstallments ? 'cuota' : 'fijo',
          originalAmount: r.originalAmount,
          originalCurrency: r.originalCurrency,
          exchangeRate: r.exchangeRate,
        });
      }
    }
    if (conf?.variableEstimate && withEstimate) {
      const variable = items
        .filter((i) => i.tipo === 'consumo')
        .reduce((a, i) => a + i.amount, 0);
      const extra = round2(conf.variableEstimate - variable);
      if (extra > 0) {
        items.push({
          id: `estimado-${conf.id}`,
          date: cyc.closing,
          amount: extra,
          description: 'Consumos variables estimados',
          card: key,
          pending: true,
          tipo: 'estimado',
        });
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  private cycleSummary(cycle: CardCycle, items: CycleItem[]) {
    return {
      cycle,
      items,
      total: round2(items.reduce((a, i) => a + i.amount, 0)),
      totalUsd: round2(
        items
          .filter((i) => i.originalCurrency === 'USD')
          .reduce((a, i) => a + (i.originalAmount || 0), 0),
      ),
    };
  }

  /**
   * Resumen de cada tarjeta que vence en `month`. Tarjetas configuradas:
   * su ciclo real, y en el mes en curso solo si todavía no venció (si ya
   * venció y no está cargado, se asume pagado por fuera). Sin configurar:
   * mes calendario anterior, solo meses futuros. Las que ya tienen el pago
   * cargado ese mes no se estiman.
   */
  private estimateStatements(
    month: string,
    today: string,
    buffer: any[],
    recurring: any[],
    paidStatements: { card: string | null }[],
    cards: CardRow[],
    now: Date,
  ) {
    const keys: (string | null)[] = [];
    for (const k of [
      ...cards.map(cardKey),
      ...buffer.map((e) => e.card as string | null),
      ...recurring.filter((r) => r.tarjeta).map((r) => r.card as string | null),
    ]) {
      if (!keys.some((x) => sameCard(x, k))) keys.push(k);
    }
    const current = today.slice(0, 7);
    const out: {
      card: string | null;
      label: string;
      due: string;
      closing: string;
      total: number;
      items: CycleItem[];
    }[] = [];
    for (const key of keys) {
      const { conf, cfg } = this.cardConfig(cards, key);
      if (!conf && month <= current) continue;
      if (paidStatements.some((st) => sameCard(st.card, key))) continue;
      const cyc = cycleDueIn(month, cfg);
      if (month === current && cyc.due < today) continue;
      const items = this.cycleItems(key, cyc, buffer, recurring, conf, now);
      if (!items.length) continue;
      out.push({
        card: key,
        label: cardLabel(key, conf),
        due: cyc.due,
        closing: cyc.closing,
        total: round2(items.reduce((a, i) => a + i.amount, 0)),
        items,
      });
    }
    // La propia primero
    return out.sort((a, b) =>
      a.card === null ? -1 : b.card === null ? 1 : a.label.localeCompare(b.label),
    );
  }

  // ── Tarjetas: config, resumen y detalle ───────────────────

  async getCards(userId: string) {
    return this.prisma.creditCard.findMany({
      where: { userId },
      orderBy: [{ isOwn: 'desc' }, { name: 'asc' }],
    });
  }

  /** Crea o actualiza la config de una tarjeta (una sola propia por usuario). */
  async upsertCard(userId: string, dto: CardConfigDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Falta el nombre de la tarjeta');
    for (const d of [dto.closingDay, dto.dueDay]) {
      if (!Number.isInteger(d) || d < 1 || d > 31) {
        throw new BadRequestException('Los días de cierre y vencimiento van de 1 a 31');
      }
    }
    const isOwn = !!dto.isOwn;
    const existing = await this.prisma.creditCard.findFirst({
      where: isOwn ? { userId, isOwn: true } : { userId, name },
    });
    const data = {
      name,
      isOwn,
      label: dto.label === undefined ? undefined : dto.label?.trim() || null,
      kind: dto.kind || (isOwn ? 'propia' : undefined),
      payee: dto.payee === undefined ? undefined : dto.payee?.trim() || null,
      closingDay: dto.closingDay,
      dueDay: dto.dueDay,
      variableEstimate:
        dto.variableEstimate === undefined ? undefined : dto.variableEstimate || null,
    };
    if (existing) {
      return this.prisma.creditCard.update({ where: { id: existing.id }, data });
    }
    return this.prisma.creditCard.create({
      data: { ...data, userId, kind: data.kind || 'adicional' },
    });
  }

  /**
   * Carga el pago del resumen de una tarjeta: crea el gasto real (fechado al
   * pago, puede ser futuro) y salda los consumos del buffer de esa tarjeta
   * hasta el cierre. Los saldados quedan como detalle/historial
   * (tarjeta-saldada, fuera del balance) linkeados al pago por statementId.
   * Sin fecha ni cierre, salen del próximo ciclo a pagar de la tarjeta.
   */
  async payCardStatement(userId: string, dto: CardStatementDto) {
    const cards = await this.prisma.creditCard.findMany({ where: { userId } });
    const { conf, cfg } = this.cardConfig(cards, dto.card?.trim() || null);
    const date = dto.date || nextDueCycle(getLocalDateString(), cfg).due;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Fecha de pago inválida (YYYY-MM-DD)');
    }
    const closing = dto.closingDate || cycleDueIn(date.slice(0, 7), cfg).closing;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closing)) {
      throw new BadRequestException('Fecha de cierre inválida (YYYY-MM-DD)');
    }
    const ars = dto.amount ?? 0;
    if (ars < 0) throw new BadRequestException('Monto inválido');
    const usd =
      dto.amountUsd !== undefined && dto.amountUsd > 0
        ? usdFields(dto.amountUsd, dto.exchangeRate)
        : null;
    if (ars <= 0 && !usd) {
      throw new BadRequestException('El resumen no tiene monto (pesos ni USD)');
    }

    const buffer = await this.prisma.expense.findMany({
      where: { userId, source: 'tarjeta-pendiente' },
      orderBy: { date: 'asc' },
    });
    const ofCard = buffer.filter((e) => sameCard(e.card, dto.card));
    // Nombre canónico: el de la config, el buffer o los recurrentes
    let card = dto.card?.trim() || null;
    if (card) {
      const recs = await this.prisma.recurringExpense.findMany({
        where: { userId, tarjeta: true },
      });
      card =
        (conf && !conf.isOwn ? conf.name : null) ||
        ofCard.find((e) => e.card)?.card ||
        recs.find((r) => sameCard(r.card, card))?.card ||
        card;
    }
    const label = cardLabel(card, conf);
    const base = dto.description?.trim() || `Resumen tarjeta ${label}`;

    const created: any[] = [];
    if (ars > 0) {
      created.push(
        await this.prisma.expense.create({
          data: {
            userId,
            date,
            amount: ars,
            description: usd ? `${base} (pesos)` : base,
            source: 'resumen-tarjeta',
            card,
          },
        }),
      );
    }
    if (usd) {
      created.push(
        await this.prisma.expense.create({
          data: {
            userId,
            date,
            ...usd,
            description: `${base} (USD ${dto.amountUsd})`,
            source: 'resumen-tarjeta',
            card,
          },
        }),
      );
    }

    const settled = ofCard.filter((e) => e.date <= closing);
    if (settled.length) {
      await this.prisma.expense.updateMany({
        where: { id: { in: settled.map((e) => e.id) }, userId },
        data: { source: 'tarjeta-saldada', statementId: created[0].id },
      });
    }
    const total = round2(created.reduce((a, e) => a + e.amount, 0));
    const settledTotal = round2(settled.reduce((a, e) => a + e.amount, 0));
    return {
      card,
      label,
      date,
      closing,
      expenses: created,
      total,
      settled,
      settledTotal,
      // Lo del resumen que no estaba anotado en el buffer
      untracked: round2(total - settledTotal),
      remaining: ofCard.filter((e) => e.date > closing),
    };
  }

  /** Consumos de crédito sin pagar (buffer de todas las tarjetas). */
  async getCardPending(userId: string) {
    return this.prisma.expense.findMany({
      where: { userId, source: 'tarjeta-pendiente' },
      include: { category: true },
      orderBy: { date: 'asc' },
    });
  }

  /** Tarjetas conocidas (config, buffer, recurrentes y resúmenes pagados). */
  async listCards(userId: string) {
    const [buffer, recs, statements, cards] = await Promise.all([
      this.prisma.expense.findMany({
        where: { userId, source: 'tarjeta-pendiente' },
      }),
      this.prisma.recurringExpense.findMany({
        where: { userId, tarjeta: true, active: true },
      }),
      this.prisma.expense.findMany({
        where: { userId, source: 'resumen-tarjeta' },
      }),
      this.prisma.creditCard.findMany({ where: { userId } }),
    ]);
    const keys: (string | null)[] = [];
    for (const c of [
      ...cards.map(cardKey),
      ...buffer.map((e) => e.card),
      ...recs.map((r) => r.card),
      ...statements.map((e) => e.card),
    ]) {
      if (!keys.some((k) => sameCard(k, c))) keys.push(c);
    }
    return keys.map((card) => {
      const { conf } = this.cardConfig(cards, card);
      return {
        card,
        label: cardLabel(card, conf),
        closingDay: conf?.closingDay ?? null,
        dueDay: conf?.dueDay ?? null,
        pendiente: buffer
          .filter((e) => sameCard(e.card, card))
          .reduce((a, e) => a + e.amount, 0),
        mensual: recs
          .filter((r) => sameCard(r.card, card))
          .reduce((a, r) => a + r.amount, 0),
      };
    });
  }

  /**
   * Todo lo de una tarjeta / persona (ej: la adicional del hermano): config
   * del ciclo, resumen a pagar y ciclo abierto (ARS + USD), ítems (fijos y
   * cuotas, cuántas faltan y cuándo terminan, cuánto lleva pagado cada uno),
   * consumos de ciclos ya vencidos sin saldar y resúmenes pagados.
   */
  async getCardDetail(userId: string, card: string | null) {
    const now = new Date();
    const today = getLocalDateString();
    const [recsAll, buffer, statementsAll, cards] = await Promise.all([
      this.prisma.recurringExpense.findMany({
        where: { userId, tarjeta: true },
        orderBy: [{ active: 'desc' }, { dayOfMonth: 'asc' }],
      }),
      this.prisma.expense.findMany({
        where: { userId, source: 'tarjeta-pendiente' },
        orderBy: { date: 'asc' },
      }),
      this.prisma.expense.findMany({
        where: { userId, source: 'resumen-tarjeta' },
        orderBy: { date: 'desc' },
      }),
      this.prisma.creditCard.findMany({ where: { userId } }),
    ]);
    const { conf, cfg } = this.cardConfig(cards, card);
    const recs = recsAll.filter((r) => sameCard(r.card, card));
    const pending = buffer.filter((e) => sameCard(e.card, card));
    const statements = statementsAll.filter((e) => sameCard(e.card, card));
    const history = recs.length
      ? await this.prisma.expense.findMany({
          where: { userId, recurringExpenseId: { in: recs.map((r) => r.id) } },
        })
      : [];

    const items = recs.map((r) => {
      const posted = history.filter((h) => h.recurringExpenseId === r.id);
      const postedTotal = posted.reduce((a, h) => a + h.amount, 0);
      return {
        id: r.id,
        description: r.description,
        amount: r.amount,
        originalAmount: r.originalAmount,
        originalCurrency: r.originalCurrency,
        exchangeRate: r.exchangeRate,
        dayOfMonth: r.dayOfMonth,
        active: r.active,
        totalInstallments: r.totalInstallments,
        installmentsPaid: r.installmentsPaid,
        cuotasRestantes: r.totalInstallments
          ? Math.max(0, r.totalInstallments - r.installmentsPaid)
          : null,
        endPeriod: recurringEndPeriod(r, now),
        // Cuotas: lo pagado sale del contador (incluye las previas a cargarlo);
        // fijos sin fin: lo registrado.
        pagado: r.totalInstallments
          ? round2(r.installmentsPaid * r.amount)
          : round2(postedTotal),
        registros: posted.length,
      };
    });

    // Ciclos: el próximo a pagar (puede estar cerrado esperando el
    // vencimiento) y el abierto que sigue acumulando.
    const aPagarCycle = nextDueCycle(today, cfg);
    const abiertoCycle = nextCycle(aPagarCycle, cfg);
    const paidThisCycle = statements.some((e) => e.date.startsWith(aPagarCycle.due.slice(0, 7)));
    const aPagar = this.cycleSummary(
      aPagarCycle,
      this.cycleItems(card, aPagarCycle, pending, recs, conf, now, !paidThisCycle),
    );
    const cicloAbierto = this.cycleSummary(
      abiertoCycle,
      this.cycleItems(card, abiertoCycle, pending, recs, conf, now),
    );

    const label =
      card === null
        ? cardLabel(null, conf)
        : conf?.label || recs[0]?.card || pending[0]?.card || statements[0]?.card || card;
    return {
      card: card === null ? null : conf?.name || recs[0]?.card || pending[0]?.card || card,
      label,
      config: conf
        ? {
            closingDay: conf.closingDay,
            dueDay: conf.dueDay,
            kind: conf.kind,
            payee: conf.payee,
            variableEstimate: conf.variableEstimate,
          }
        : null,
      aPagar: { ...aPagar, yaCargado: paidThisCycle },
      cicloAbierto,
      vencidosSinSaldar: pending
        .filter((e) => e.date < aPagarCycle.start)
        .map((e) => ({ id: e.id, date: e.date, amount: e.amount, description: e.description })),
      items,
      mensualActivo: round2(
        items.filter((i) => i.active).reduce((a, i) => a + i.amount, 0),
      ),
      pendiente: {
        total: round2(pending.reduce((a, e) => a + e.amount, 0)),
        items: pending.map((e) => ({
          id: e.id,
          date: e.date,
          amount: e.amount,
          description: e.description,
        })),
      },
      resumenesPagados: statements.map((e) => ({
        id: e.id,
        date: e.date,
        amount: e.amount,
        description: e.description,
        originalAmount: e.originalAmount,
        originalCurrency: e.originalCurrency,
        exchangeRate: e.exchangeRate,
      })),
    };
  }

  // ── Resumen / insights ────────────────────────────────────

  async getSummary(userId: string, month: string) {
    const [y, m] = month.split('-').map(Number);
    const prev = new Date(y, m - 2, 1); // mes anterior
    const prevMonth = periodOf(prev);

    const [expenses, prevExpenses, categories, recurring] = await Promise.all([
      this.prisma.expense.findMany({
        where: {
          userId,
          date: monthRange(month),
          source: { notIn: OFF_BALANCE_SOURCES },
        },
      }),
      this.prisma.expense.findMany({
        where: {
          userId,
          date: monthRange(prevMonth),
          source: { notIn: OFF_BALANCE_SOURCES },
        },
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
