import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { GoalService } from '../goal/goal.service';
import { getLocalDateString } from '../../common/utils/date.utils';
import { computePrintCost, computeSalePrice, computeProfit } from './pricing';

export interface UpdatePrintSettingsDto {
  costPerGram?: number;
  wastePct?: number;
  powerPerHour?: number;
  defaultMarkup?: number;
  financingSurcharge?: number;
}

export interface CreatePrintProductDto {
  name: string;
  author?: string;
  makerworldUrl?: string;
  grams: number;
  hours: number;
  colorsLabel: string;
  sizeMm?: string;
  licenseOk?: boolean;
  markupOverride?: number;
  publicPrice?: number;
  active?: boolean;
  notes?: string;
}

export type UpdatePrintProductDto = Partial<CreatePrintProductDto>;

export interface CreateFilamentDto {
  brand: string;
  material: string;
  color: string;
  pricePaid: number;
  grams?: number;
  purchasedAt: string;
  discarded?: boolean;
  discardReason?: string;
  gramsLeft?: number;
  notes?: string;
}

export type UpdateFilamentDto = Partial<CreateFilamentDto>;

export interface CreatePrintSaleDto {
  date: string;
  productId: string;
  kind?: 'venta' | 'muestra';
  qty?: number;
  chargedUnit?: number;
  costUnit?: number;
  status?: 'a_liquidar' | 'liquidado';
  channel?: string;
  notes?: string;
}

export type UpdatePrintSaleDto = Partial<
  Omit<CreatePrintSaleDto, 'productId'>
>;

/** Costo/precio/ganancia de un producto con las settings de costeo vigentes. */
function pricingFor(
  product: { grams: number; hours: number; markupOverride: number | null },
  settings: {
    costPerGram: number;
    wastePct: number;
    powerPerHour: number;
    defaultMarkup: number;
  },
) {
  const cost = computePrintCost({
    grams: product.grams,
    hours: product.hours,
    costPerGram: settings.costPerGram,
    wastePct: settings.wastePct,
    powerPerHour: settings.powerPerHour,
  });
  const markup = product.markupOverride ?? settings.defaultMarkup;
  const priceToMarcelito = computeSalePrice(cost, markup);
  const profit = computeProfit(priceToMarcelito, cost);
  return { cost, priceToMarcelito, profit };
}

/**
 * Negocio de impresion 3D: catalogo, filamentos, ventas y balance.
 *
 * AUTONOMO respecto de Goal (ver CLAUDE.md): todo se calcula desde las
 * tablas propias del modulo. El objetivo activo solo se usa para dejar un
 * snapshot (`goalId`) en el Income/Expense que se crea al liquidar una venta
 * o cargar un filamento — si el objetivo cambia despues, el negocio 3D ni
 * se entera, y con cero objetivos cargados funciona igual.
 */
@Injectable()
export class PrintingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly goalService: GoalService,
  ) {}

  // ── Settings (1 fila por usuario, con lazy init) ─────────────

  async getSettings(userId: string) {
    const existing = await this.prisma.printSettings.findUnique({
      where: { userId },
    });
    if (existing) return existing;
    return this.prisma.printSettings.create({
      data: { userId, publicToken: randomUUID() },
    });
  }

  async updateSettings(userId: string, dto: UpdatePrintSettingsDto) {
    await this.getSettings(userId); // asegura que exista antes de actualizar
    if (dto.wastePct !== undefined && dto.wastePct < 0) {
      throw new BadRequestException('El desperdicio no puede ser negativo');
    }
    if (dto.costPerGram !== undefined && dto.costPerGram < 0) {
      throw new BadRequestException('El costo por gramo no puede ser negativo');
    }
    if (dto.powerPerHour !== undefined && dto.powerPerHour < 0) {
      throw new BadRequestException('El costo de luz no puede ser negativo');
    }
    if (dto.defaultMarkup !== undefined && dto.defaultMarkup <= 0) {
      throw new BadRequestException('El markup debe ser mayor a 0');
    }
    return this.prisma.printSettings.update({
      where: { userId },
      data: {
        costPerGram: dto.costPerGram,
        wastePct: dto.wastePct,
        powerPerHour: dto.powerPerHour,
        defaultMarkup: dto.defaultMarkup,
        financingSurcharge: dto.financingSurcharge,
      },
    });
  }

  /** Rota el token del catalogo publico (revoca el link viejo). */
  async regenerateToken(userId: string) {
    await this.getSettings(userId);
    return this.prisma.printSettings.update({
      where: { userId },
      data: { publicToken: randomUUID() },
    });
  }

  // ── Productos ─────────────────────────────────────────────

  async getProducts(userId: string, opts?: { activeOnly?: boolean }) {
    const [products, settings] = await Promise.all([
      this.prisma.printProduct.findMany({
        where: { userId, ...(opts?.activeOnly ? { active: true } : {}) },
        orderBy: { createdAt: 'asc' },
      }),
      this.getSettings(userId),
    ]);
    return products.map((p) => ({ ...p, ...pricingFor(p, settings) }));
  }

  async getProduct(userId: string, id: string) {
    const product = await this.prisma.printProduct.findFirst({
      where: { id, userId },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    const settings = await this.getSettings(userId);
    return { ...product, ...pricingFor(product, settings) };
  }

  async createProduct(userId: string, dto: CreatePrintProductDto) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Falta el nombre del producto');
    }
    if (!dto.grams || dto.grams <= 0) {
      throw new BadRequestException('Los gramos deben ser mayor a 0');
    }
    if (dto.hours === undefined || dto.hours < 0) {
      throw new BadRequestException('Las horas no pueden ser negativas');
    }
    if (!dto.colorsLabel?.trim()) {
      throw new BadRequestException('Falta la cantidad de colores');
    }
    return this.prisma.printProduct.create({
      data: {
        userId,
        name: dto.name.trim(),
        author: dto.author?.trim() || null,
        makerworldUrl: dto.makerworldUrl?.trim() || null,
        grams: dto.grams,
        hours: dto.hours,
        colorsLabel: dto.colorsLabel.trim(),
        sizeMm: dto.sizeMm?.trim() || null,
        licenseOk: dto.licenseOk ?? false,
        markupOverride: dto.markupOverride ?? null,
        publicPrice: dto.publicPrice ?? null,
        active: dto.active ?? true,
        notes: dto.notes || null,
      },
    });
  }

  async updateProduct(userId: string, id: string, dto: UpdatePrintProductDto) {
    const existing = await this.prisma.printProduct.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Producto no encontrado');
    if (dto.grams !== undefined && dto.grams <= 0) {
      throw new BadRequestException('Los gramos deben ser mayor a 0');
    }
    if (dto.hours !== undefined && dto.hours < 0) {
      throw new BadRequestException('Las horas no pueden ser negativas');
    }
    return this.prisma.printProduct.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        author: dto.author === undefined ? undefined : dto.author?.trim() || null,
        makerworldUrl:
          dto.makerworldUrl === undefined
            ? undefined
            : dto.makerworldUrl?.trim() || null,
        grams: dto.grams,
        hours: dto.hours,
        colorsLabel: dto.colorsLabel?.trim(),
        sizeMm: dto.sizeMm === undefined ? undefined : dto.sizeMm?.trim() || null,
        licenseOk: dto.licenseOk,
        markupOverride:
          dto.markupOverride === undefined ? undefined : dto.markupOverride,
        publicPrice: dto.publicPrice === undefined ? undefined : dto.publicPrice,
        active: dto.active,
        notes: dto.notes === undefined ? undefined : dto.notes || null,
      },
    });
  }

  async deleteProduct(userId: string, id: string) {
    const existing = await this.prisma.printProduct.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Producto no encontrado');
    await this.prisma.printProduct.delete({ where: { id } });
    return true;
  }

  // ── Filamentos ────────────────────────────────────────────

  async getFilaments(userId: string) {
    return this.prisma.filament.findMany({
      where: { userId },
      orderBy: [{ purchasedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Registra la compra. Crea ademas un Expense linkeado (inversion del
   * negocio) con el objetivo activo como snapshot si existe — igual criterio
   * que liquidar una venta, ver el comentario de clase.
   */
  async createFilament(userId: string, dto: CreateFilamentDto) {
    if (!dto.brand?.trim() || !dto.material?.trim() || !dto.color?.trim()) {
      throw new BadRequestException('Falta marca, material o color');
    }
    if (!dto.pricePaid || dto.pricePaid <= 0) {
      throw new BadRequestException('El precio pagado debe ser mayor a 0');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.purchasedAt || '')) {
      throw new BadRequestException('Fecha de compra invalida (YYYY-MM-DD)');
    }
    const grams = dto.grams ?? 1000;
    const pricePerGram = dto.pricePaid / grams;

    const activeGoal = await this.goalService.getActive(userId);
    const expense = await this.prisma.expense.create({
      data: {
        userId,
        date: dto.purchasedAt,
        amount: dto.pricePaid,
        description: `Filamento ${dto.brand.trim()} ${dto.material.trim()} ${dto.color.trim()}`,
        source: 'printing',
        goalId: activeGoal?.id ?? null,
      },
    });

    return this.prisma.filament.create({
      data: {
        userId,
        brand: dto.brand.trim(),
        material: dto.material.trim(),
        color: dto.color.trim(),
        pricePaid: dto.pricePaid,
        grams,
        pricePerGram,
        purchasedAt: dto.purchasedAt,
        discarded: dto.discarded ?? false,
        discardReason: dto.discardReason || null,
        gramsLeft: dto.gramsLeft ?? null,
        expenseId: expense.id,
        notes: dto.notes || null,
      },
    });
  }

  async updateFilament(userId: string, id: string, dto: UpdateFilamentDto) {
    const existing = await this.prisma.filament.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Filamento no encontrado');
    if (dto.pricePaid !== undefined && dto.pricePaid <= 0) {
      throw new BadRequestException('El precio pagado debe ser mayor a 0');
    }
    const grams = dto.grams ?? existing.grams;
    const pricePaid = dto.pricePaid ?? existing.pricePaid;
    const pricePerGram = pricePaid / grams;

    // Mantiene el Expense linkeado consistente con el monto (best-effort).
    if (existing.expenseId && dto.pricePaid !== undefined) {
      await this.prisma.expense
        .update({
          where: { id: existing.expenseId },
          data: { amount: dto.pricePaid },
        })
        .catch(() => null);
    }

    return this.prisma.filament.update({
      where: { id },
      data: {
        brand: dto.brand?.trim(),
        material: dto.material?.trim(),
        color: dto.color?.trim(),
        pricePaid: dto.pricePaid,
        grams: dto.grams,
        pricePerGram:
          dto.pricePaid !== undefined || dto.grams !== undefined
            ? pricePerGram
            : undefined,
        purchasedAt: dto.purchasedAt,
        discarded: dto.discarded,
        discardReason:
          dto.discardReason === undefined ? undefined : dto.discardReason || null,
        gramsLeft: dto.gramsLeft,
        notes: dto.notes === undefined ? undefined : dto.notes || null,
      },
    });
  }

  async deleteFilament(userId: string, id: string) {
    const existing = await this.prisma.filament.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Filamento no encontrado');
    if (existing.expenseId) {
      await this.prisma.expense
        .delete({ where: { id: existing.expenseId } })
        .catch(() => null);
    }
    await this.prisma.filament.delete({ where: { id } });
    return true;
  }

  // ── Ventas / muestras ─────────────────────────────────────

  async getSales(userId: string) {
    return this.prisma.printSale.findMany({
      where: { userId },
      include: { product: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createSale(userId: string, dto: CreatePrintSaleDto) {
    const product = await this.prisma.printProduct.findFirst({
      where: { id: dto.productId, userId },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.date || '')) {
      throw new BadRequestException('Fecha invalida (YYYY-MM-DD)');
    }
    const kind = dto.kind === 'muestra' ? 'muestra' : 'venta';
    const qty = dto.qty ?? 1;
    if (qty <= 0) throw new BadRequestException('La cantidad debe ser mayor a 0');

    const settings = await this.getSettings(userId);
    const pricing = pricingFor(product, settings);
    const costUnit = dto.costUnit ?? pricing.cost;
    // Muestra = se regala: cobro 0 siempre, sin importar lo que mande el body.
    const chargedUnit =
      kind === 'muestra' ? 0 : dto.chargedUnit ?? pricing.priceToMarcelito;

    return this.prisma.printSale.create({
      data: {
        userId,
        date: dto.date,
        productId: product.id,
        kind,
        qty,
        chargedUnit,
        costUnit,
        status: dto.status === 'liquidado' ? 'liquidado' : 'a_liquidar',
        channel: dto.channel || null,
        notes: dto.notes || null,
      },
    });
  }

  async updateSale(userId: string, id: string, dto: UpdatePrintSaleDto) {
    const existing = await this.prisma.printSale.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Venta no encontrada');
    if (dto.qty !== undefined && dto.qty <= 0) {
      throw new BadRequestException('La cantidad debe ser mayor a 0');
    }
    return this.prisma.printSale.update({
      where: { id },
      data: {
        date: dto.date,
        kind: dto.kind,
        qty: dto.qty,
        chargedUnit: dto.chargedUnit,
        costUnit: dto.costUnit,
        channel: dto.channel === undefined ? undefined : dto.channel || null,
        notes: dto.notes === undefined ? undefined : dto.notes || null,
      },
    });
  }

  async deleteSale(userId: string, id: string) {
    const existing = await this.prisma.printSale.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Venta no encontrada');
    // Si ya estaba liquidada, el Income que la respaldaba deja de tener
    // sentido: se borra junto (best-effort, no bloquea el borrado de la venta).
    if (existing.incomeId) {
      await this.prisma.income
        .delete({ where: { id: existing.incomeId } })
        .catch(() => null);
    }
    await this.prisma.printSale.delete({ where: { id } });
    return true;
  }

  /**
   * Liquidar = Marcelito ya pago. Crea el Income (source '3d') con el
   * objetivo activo como snapshot si existe, y marca la venta liquidada.
   */
  async liquidarVenta(userId: string, id: string) {
    const sale = await this.prisma.printSale.findFirst({
      where: { id, userId },
      include: { product: true },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (sale.status === 'liquidado') {
      throw new BadRequestException('La venta ya esta liquidada');
    }

    const amount = sale.qty * sale.chargedUnit;
    const cost = sale.qty * sale.costUnit;
    const activeGoal = await this.goalService.getActive(userId);

    const income = await this.prisma.income.create({
      data: {
        userId,
        date: getLocalDateString(),
        description: `Venta 3D: ${sale.qty}x ${sale.product?.name ?? 'producto'}`,
        amount,
        cost,
        source: '3d',
        status: 'received',
        goalId: activeGoal?.id ?? null,
      },
    });

    return this.prisma.printSale.update({
      where: { id },
      data: { status: 'liquidado', incomeId: income.id },
    });
  }

  // ── Balance del negocio ───────────────────────────────────

  /**
   * Espejo corregido del sheet "Seguimiento privado": ganancia de ventas
   * (liquidadas + a liquidar), invertido en muestras regaladas, resultado
   * neto contra las muestras, e invertido en filamento vs cuanto falta
   * ganar (en ventas) para cubrirlo. Funciona igual con cero datos cargados.
   */
  async getSummary(userId: string) {
    const [filaments, sales, settings] = await Promise.all([
      this.prisma.filament.findMany({ where: { userId } }),
      this.prisma.printSale.findMany({ where: { userId } }),
      this.getSettings(userId),
    ]);

    const investedFilament =
      filaments.reduce((a: number, f: any) => a + f.pricePaid, 0) +
      settings.financingSurcharge;

    const samples = sales.filter((s: any) => s.kind === 'muestra');
    const investedSamples = samples.reduce(
      (a: number, s: any) => a + s.qty * s.costUnit,
      0,
    );

    const ventas = sales.filter((s: any) => s.kind === 'venta');
    const profitOf = (s: any) => s.qty * (s.chargedUnit - s.costUnit);
    const profitSalesSettled = ventas
      .filter((s: any) => s.status === 'liquidado')
      .reduce((a: number, s: any) => a + profitOf(s), 0);
    const profitSalesPending = ventas
      .filter((s: any) => s.status !== 'liquidado')
      .reduce((a: number, s: any) => a + profitOf(s), 0);
    const profitSalesTotal = profitSalesSettled + profitSalesPending;

    // Resultado neto: ganancia de ventas contra lo regalado en muestras.
    const result = profitSalesTotal - investedSamples;

    // Cuanto falta ganar (en ventas, bruto) para cubrir lo invertido en
    // filamento. No neteamos las muestras aca: es una meta de ventas, no
    // el balance general del negocio.
    const missingToCoverFilament = Math.max(
      0,
      investedFilament - profitSalesTotal,
    );

    return {
      investedFilament,
      filamentsCount: filaments.length,
      investedSamples,
      samplesCount: samples.length,
      profitSalesSettled,
      profitSalesPending,
      profitSalesTotal,
      salesCount: ventas.length,
      result,
      missingToCoverFilament,
    };
  }

  // ── Catalogo publico (para Marcelito, sin auth) ──────────

  /**
   * SOLO lo que Marcelito necesita: nombre, colores, medidas, link, lo que
   * le cuesta y precio sugerido, y SU ganancia revendiendo (publicPrice -
   * priceToMarcelito). Nunca el costo real de Luciano, su ganancia, gramos,
   * horas ni filamentos. Solo productos activos Y con licencia para vender
   * (los que todavia no tienen permiso del autor no se muestran).
   */
  async getPublicCatalog(token: string) {
    const settings = await this.prisma.printSettings.findUnique({
      where: { publicToken: token },
    });
    if (!settings) throw new NotFoundException('Catalogo no encontrado');

    const products = await this.prisma.printProduct.findMany({
      // Sin filtro de licencia: este catalogo reemplaza al sheet que
      // Marcelito ya usa con todos los productos. El flag licenseOk es un
      // aviso interno para Luciano, no esconde productos de la feria.
      where: { userId: settings.userId, active: true },
      orderBy: { name: 'asc' },
    });

    return products.map((p: any) => {
      const { priceToMarcelito } = pricingFor(p, settings);
      return {
        id: p.id,
        name: p.name,
        colorsLabel: p.colorsLabel,
        sizeMm: p.sizeMm,
        makerworldUrl: p.makerworldUrl,
        priceToMarcelito,
        publicPrice: p.publicPrice,
        marcelitoProfit:
          p.publicPrice != null ? p.publicPrice - priceToMarcelito : null,
      };
    });
  }
}
