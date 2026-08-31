import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { GoalService } from '../goal/goal.service';
import { SettlementService } from './settlement.service';
import { photoUrl } from './photos.service';
import { getLocalDateString } from '../../common/utils/date.utils';
import { pricingForProduct, PricingSettings } from './pricing';

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
  /** Costo real a mano (null = volver a la formula). 0 es valido. */
  costOverride?: number | null;
  /** Precio a Marcelito a mano (null = volver al markup). 0 es valido. */
  priceOverride?: number | null;
  publicPrice?: number;
  colorBreakdown?: { color?: string; colorHex?: string; grams: number }[] | null;
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
  colorHex?: string;
  finishedAt?: string | null;
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
    private readonly settlements: SettlementService,
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

  /**
   * Producto de Prisma + los campos calculados que espera el front
   * (cost/priceToMarcelito/profit) y las URLs de las fotos. TODO endpoint que
   * devuelva un producto tiene que pasar por aca: el front usa la respuesta
   * tal cual (usePrinting.ts) y sin estos campos la card muestra "$NaN".
   */
  private hydrateProduct(product: any, settings: PricingSettings) {
    return {
      ...product,
      ...pricingForProduct(product, settings),
      photos: (product.photos ?? []).map((ph: any) => ({
        ...ph,
        url: photoUrl(ph.path),
      })),
    };
  }

  async getProducts(userId: string, opts?: { activeOnly?: boolean }) {
    const [products, settings] = await Promise.all([
      this.prisma.printProduct.findMany({
        where: { userId, ...(opts?.activeOnly ? { active: true } : {}) },
        include: { photos: { orderBy: { order: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.getSettings(userId),
    ]);
    return products.map((p: any) => this.hydrateProduct(p, settings));
  }

  async getProduct(userId: string, id: string) {
    const product: any = await this.prisma.printProduct.findFirst({
      where: { id, userId },
      include: { photos: { orderBy: { order: 'asc' } } },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    const settings = await this.getSettings(userId);
    return this.hydrateProduct(product, settings);
  }

  /** Los valores manuales pueden ser 0 (muestra) o null (volver a la formula), nunca negativos. */
  private assertOverridesOk(dto: {
    costOverride?: number | null;
    priceOverride?: number | null;
  }) {
    if (
      dto.costOverride !== undefined &&
      dto.costOverride !== null &&
      dto.costOverride < 0
    ) {
      throw new BadRequestException('El costo manual no puede ser negativo');
    }
    if (
      dto.priceOverride !== undefined &&
      dto.priceOverride !== null &&
      dto.priceOverride < 0
    ) {
      throw new BadRequestException('El precio manual no puede ser negativo');
    }
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
    this.assertOverridesOk(dto);
    const created = await this.prisma.printProduct.create({
      include: { photos: { orderBy: { order: 'asc' } } },
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
        costOverride: dto.costOverride ?? null,
        priceOverride: dto.priceOverride ?? null,
        publicPrice: dto.publicPrice ?? null,
        colorBreakdown: (dto.colorBreakdown as any) ?? undefined,
        active: dto.active ?? true,
        notes: dto.notes || null,
      },
    });
    return this.hydrateProduct(created, await this.getSettings(userId));
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
    this.assertOverridesOk(dto);
    const updated = await this.prisma.printProduct.update({
      where: { id },
      include: { photos: { orderBy: { order: 'asc' } } },
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
        // undefined = no lo toques; null = borrar el manual y volver a la formula
        costOverride:
          dto.costOverride === undefined ? undefined : dto.costOverride,
        priceOverride:
          dto.priceOverride === undefined ? undefined : dto.priceOverride,
        publicPrice: dto.publicPrice === undefined ? undefined : dto.publicPrice,
        colorBreakdown:
          dto.colorBreakdown === undefined ? undefined : (dto.colorBreakdown as any),
        active: dto.active,
        notes: dto.notes === undefined ? undefined : dto.notes || null,
      },
    });
    return this.hydrateProduct(updated, await this.getSettings(userId));
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
        // Un rollo recien comprado entra LLENO al stock (se puede pisar).
        gramsLeft: dto.gramsLeft ?? grams,
        colorHex: dto.colorHex || null,
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
        colorHex: dto.colorHex === undefined ? undefined : dto.colorHex || null,
        finishedAt: dto.finishedAt === undefined ? undefined : dto.finishedAt,
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
    const sales = await this.prisma.printSale.findMany({
      where: { userId },
      include: {
        product: true,
        settlements: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    // total/cobrado/restante por venta (contempla las liquidadas legacy)
    return sales.map((s: any) => ({ ...s, ...this.settlements.settledInfo(s) }));
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
    const pricing = pricingForProduct(product, settings);
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
    // Los pagos parciales tambien respaldaban Incomes: se borran junto
    // (las filas de settlement caen solas por el onDelete: Cascade).
    const settlements = await this.prisma.printSaleSettlement.findMany({
      where: { saleId: id },
    });
    for (const st of settlements) {
      if (st.incomeId) {
        await this.prisma.income
          .delete({ where: { id: st.incomeId } })
          .catch(() => null);
      }
    }
    await this.prisma.printSale.delete({ where: { id } });
    return true;
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
      this.prisma.printSale.findMany({
        where: { userId },
        include: { settlements: true },
      }),
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
    // Prorrateo por lo realmente cobrado: una venta pagada a medias aporta
    // la mitad de su ganancia a "liquidada" y la otra mitad a "a liquidar".
    let profitSalesSettled = 0;
    let profitSalesPending = 0;
    for (const s of ventas as any[]) {
      const { total, settledAmount } = this.settlements.settledInfo(s);
      const frac = total > 0 ? settledAmount / total : 0;
      profitSalesSettled += profitOf(s) * frac;
      profitSalesPending += profitOf(s) * (1 - frac);
    }
    profitSalesSettled = Math.round(profitSalesSettled * 100) / 100;
    profitSalesPending = Math.round(profitSalesPending * 100) / 100;
    const profitSalesTotal =
      Math.round((profitSalesSettled + profitSalesPending) * 100) / 100;

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
      include: { photos: { orderBy: { order: 'asc' } } },
      orderBy: { name: 'asc' },
    });

    return products.map((p: any) => {
      const { priceToMarcelito } = pricingForProduct(p, settings);
      return {
        id: p.id,
        name: p.name,
        colorsLabel: p.colorsLabel,
        sizeMm: p.sizeMm,
        makerworldUrl: p.makerworldUrl,
        photos: (p.photos ?? []).map((ph: any) => photoUrl(ph.path)),
        priceToMarcelito,
        publicPrice: p.publicPrice,
        marcelitoProfit:
          p.publicPrice != null ? p.publicPrice - priceToMarcelito : null,
      };
    });
  }
}
