import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { SettlementService } from './settlement.service';
import { pricingForProduct } from './pricing';
import { getLocalDateString } from '../../common/utils/date.utils';

export const ORDER_STATUSES = [
  'pedido',
  'confirmado',
  'imprimiendo',
  'listo',
  'entregado',
  'cancelado',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface CreatePublicOrderDto {
  customerName?: string;
  items: { productId: string; qty: number }[];
  notes?: string;
}

export interface CreatePaymentNoticeDto {
  orderId?: string;
  amount?: number;
  message?: string;
}

export interface OwnerOrderItemDto {
  productId: string;
  qty: number;
  unitPrice?: number; // sin esto: precio a Marcelito vigente
}

export interface CreateOwnerOrderDto {
  customerName?: string;
  items: OwnerOrderItemDto[];
  notes?: string;
  status?: OrderStatus;
}

export interface UpdateOwnerOrderDto {
  customerName?: string;
  notes?: string;
  items?: OwnerOrderItemDto[]; // solo editables mientras no haya ventas
}

/** ¿La venta tiene plata registrada? (pagos parciales o legacy liquidada) */
function saleHasPayments(s: any): boolean {
  return !!s.incomeId || (s.settlements ?? []).length > 0;
}

/**
 * Pedidos que Marcelito arma desde el catalogo publico (identificado por el
 * token del catalogo, sin auth) y su seguimiento del lado de Luciano.
 *
 * Flujo: pedido -> confirmado -> imprimiendo -> listo -> entregado.
 * Al marcar "entregado" se crea una PrintSale a_liquidar por item (con el
 * precio snapshot del momento del pedido) y de ahi en mas la plata se
 * sigue por el circuito normal de liquidaciones (parciales incluidas).
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: SettlementService,
  ) {}

  private async settingsByToken(token: string) {
    const settings = await this.prisma.printSettings.findUnique({
      where: { publicToken: token },
    });
    if (!settings) throw new NotFoundException('Catalogo no encontrado');
    return settings;
  }

  // ── Lado publico (Marcelito) ─────────────────────────────

  async createPublicOrder(token: string, dto: CreatePublicOrderDto) {
    const settings = await this.settingsByToken(token);

    const items = dto.items ?? [];
    if (!items.length) {
      throw new BadRequestException('El pedido no tiene productos');
    }
    if (items.some((i) => !i.productId || !Number.isFinite(i.qty) || i.qty <= 0)) {
      throw new BadRequestException('Cantidad invalida en el pedido');
    }
    if (items.reduce((a, i) => a + i.qty, 0) > 500) {
      throw new BadRequestException('El pedido es demasiado grande');
    }

    const products = await this.prisma.printProduct.findMany({
      where: {
        userId: settings.userId,
        active: true,
        id: { in: items.map((i) => i.productId) },
      },
    });
    const byId = new Map(products.map((p: any) => [p.id, p]));
    for (const item of items) {
      if (!byId.has(item.productId)) {
        throw new BadRequestException('Hay un producto que ya no esta disponible');
      }
    }

    const order = await this.prisma.printOrder.create({
      data: {
        userId: settings.userId,
        customerName: dto.customerName?.trim() || 'Marcelito',
        status: 'pedido',
        notes: dto.notes?.trim() || null,
        items: {
          create: items.map((i) => {
            const product = byId.get(i.productId)!;
            const { priceToMarcelito } = pricingForProduct(product, settings);
            return {
              productId: i.productId,
              qty: Math.floor(i.qty),
              unitPrice: priceToMarcelito,
            };
          }),
        },
      },
      include: { items: { include: { product: true } } },
    });
    return this.toPublicOrder(order);
  }

  /** Vista de pedidos para el link publico: estado + totales + deuda. */
  async getPublicOrders(token: string) {
    const settings = await this.settingsByToken(token);
    const [orders, sales, pendingNotices] = await Promise.all([
      this.prisma.printOrder.findMany({
        where: { userId: settings.userId },
        include: {
          items: { include: { product: true } },
          sales: { include: { settlements: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      // Deuda: solo las ventas nacidas de pedidos del link (no la feria).
      this.prisma.printSale.findMany({
        where: { userId: settings.userId, orderId: { not: null }, kind: 'venta' },
        include: { settlements: true },
      }),
      this.prisma.printPaymentNotice.findMany({
        where: { userId: settings.userId, status: 'pendiente' },
      }),
    ]);
    const debt = sales.reduce(
      (a: number, s: any) => a + this.settlements.settledInfo(s).remaining,
      0,
    );
    const noticeOrderIds = new Set<string>(
      pendingNotices.map((n: any) => n.orderId).filter(Boolean),
    );
    return {
      orders: orders.map((o: any) => this.toPublicOrder(o, noticeOrderIds)),
      debt: Math.round(debt * 100) / 100,
    };
  }

  /** Solo lo que Marcelito tiene que ver de su pedido (nunca costos). */
  private toPublicOrder(order: any, pendingNoticeOrderIds?: Set<string>) {
    const items = (order.items ?? []).map((i: any) => ({
      productId: i.productId,
      name: i.product?.name ?? 'producto',
      qty: i.qty,
      unitPrice: i.unitPrice,
      subtotal: i.qty * i.unitPrice,
    }));
    const { paid, due } = this.orderPaymentInfo(order);
    return {
      id: order.id,
      customerName: order.customerName,
      status: order.status,
      notes: order.notes,
      createdAt: order.createdAt,
      items,
      total: items.reduce((a: number, i: any) => a + i.subtotal, 0),
      paid,
      due,
      // Solo tiene sentido cuando el pedido ya se entrego (hay ventas)
      paymentStatus:
        order.status === 'entregado'
          ? due <= 0
            ? 'pagado'
            : paid > 0
              ? 'parcial'
              : 'debe'
          : null,
      noticePending: pendingNoticeOrderIds?.has(order.id) ?? false,
    };
  }

  /** Cobrado y adeudado de un pedido, sumando sus ventas (legacy-aware). */
  private orderPaymentInfo(order: { sales?: any[] }) {
    const ventas = (order.sales ?? []).filter((s: any) => s.kind === 'venta');
    let paid = 0;
    let due = 0;
    for (const s of ventas) {
      const info = this.settlements.settledInfo(s);
      paid += info.settledAmount;
      due += info.remaining;
    }
    return {
      paid: Math.round(paid * 100) / 100,
      due: Math.round(due * 100) / 100,
    };
  }

  async createPaymentNotice(token: string, dto: CreatePaymentNoticeDto) {
    const settings = await this.settingsByToken(token);
    if (dto.amount !== undefined && (!Number.isFinite(dto.amount) || dto.amount <= 0)) {
      throw new BadRequestException('Monto invalido');
    }
    // Un aviso puede venir vacio si apunta a un pedido: significa
    // "pague todo lo que debo de este pedido" (se resuelve al confirmar).
    if (!dto.orderId && !dto.amount && !dto.message?.trim()) {
      throw new BadRequestException('Falta el pedido, el monto o un mensaje');
    }
    return this.prisma.printPaymentNotice.create({
      data: {
        userId: settings.userId,
        orderId: dto.orderId || null,
        amount: dto.amount ?? null,
        message: dto.message?.trim().slice(0, 500) || null,
      },
    });
  }

  // ── Lado dueno (Luciano) ─────────────────────────────────

  /** Valida items y resuelve el unitPrice (manual o precio a Marcelito). */
  private async resolveOwnerItems(userId: string, items: OwnerOrderItemDto[]) {
    if (!items?.length) {
      throw new BadRequestException('El pedido no tiene productos');
    }
    if (
      items.some(
        (i) =>
          !i.productId ||
          !Number.isFinite(i.qty) ||
          i.qty <= 0 ||
          (i.unitPrice !== undefined &&
            (!Number.isFinite(i.unitPrice) || i.unitPrice < 0)),
      )
    ) {
      throw new BadRequestException('Item invalido en el pedido');
    }
    const [products, settings] = await Promise.all([
      this.prisma.printProduct.findMany({
        where: { userId, id: { in: items.map((i) => i.productId) } },
      }),
      this.prisma.printSettings.findUnique({ where: { userId } }),
    ]);
    const byId = new Map(products.map((p: any) => [p.id, p]));
    return items.map((i) => {
      const product = byId.get(i.productId);
      if (!product) throw new BadRequestException('Producto no encontrado');
      const unitPrice =
        i.unitPrice ??
        (settings ? pricingForProduct(product, settings).priceToMarcelito : 0);
      return { productId: i.productId, qty: Math.floor(i.qty), unitPrice };
    });
  }

  /** Convierte los items del pedido en PrintSales a_liquidar (al entregar). */
  private async createSalesForOrder(
    userId: string,
    order: { id: string; customerName: string; items: any[] },
  ) {
    const settings = await this.prisma.printSettings.findUnique({
      where: { userId },
    });
    const products = await this.prisma.printProduct.findMany({
      where: { userId, id: { in: order.items.map((i: any) => i.productId) } },
    });
    const byId = new Map(products.map((p: any) => [p.id, p]));
    for (const item of order.items as any[]) {
      const product = byId.get(item.productId);
      const costUnit =
        product && settings ? pricingForProduct(product, settings).cost : 0;
      await this.prisma.printSale.create({
        data: {
          userId,
          date: getLocalDateString(),
          productId: item.productId,
          kind: 'venta',
          qty: item.qty,
          chargedUnit: item.unitPrice,
          costUnit,
          status: 'a_liquidar',
          channel: `pedido ${order.customerName}`,
          orderId: order.id,
        },
      });
    }
  }

  /** Alta manual de un pedido por Luciano (ej: se lo pidieron por WhatsApp). */
  async createOrder(userId: string, dto: CreateOwnerOrderDto) {
    const status: OrderStatus =
      dto.status && ORDER_STATUSES.includes(dto.status) ? dto.status : 'pedido';
    const items = await this.resolveOwnerItems(userId, dto.items);
    const order = await this.prisma.printOrder.create({
      data: {
        userId,
        customerName: dto.customerName?.trim() || 'Marcelito',
        status,
        notes: dto.notes?.trim() || null,
        items: { create: items },
      },
      include: { items: true, sales: true },
    });
    if (status === 'entregado' && !(order.sales ?? []).length) {
      await this.createSalesForOrder(userId, order);
    }
    return order;
  }

  /**
   * Edicion de un pedido. Cliente y notas se tocan siempre; los items solo
   * mientras el pedido no haya generado ventas (despues de entregar, la
   * venta es la verdad economica y se edita desde Ventas).
   */
  async updateOrder(userId: string, id: string, dto: UpdateOwnerOrderDto) {
    const order = await this.prisma.printOrder.findFirst({
      where: { id, userId },
      include: { sales: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    if (dto.items) {
      if ((order.sales ?? []).length) {
        throw new BadRequestException(
          'El pedido ya genero ventas: los cambios de plata van por Ventas',
        );
      }
      const items = await this.resolveOwnerItems(userId, dto.items);
      await this.prisma.printOrderItem.deleteMany({ where: { orderId: id } });
      await this.prisma.printOrderItem.createMany({
        data: items.map((i) => ({ ...i, orderId: id })),
      });
    }

    return this.prisma.printOrder.update({
      where: { id },
      data: {
        customerName:
          dto.customerName === undefined ? undefined : dto.customerName.trim() || 'Marcelito',
        notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
      },
      include: { items: { include: { product: true } }, sales: true },
    });
  }

  async getOrders(userId: string) {
    return this.prisma.printOrder.findMany({
      where: { userId },
      include: {
        items: { include: { product: true } },
        sales: { include: { settlements: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(userId: string, id: string, status: OrderStatus) {
    if (!ORDER_STATUSES.includes(status)) {
      throw new BadRequestException('Estado invalido');
    }
    const order = await this.prisma.printOrder.findFirst({
      where: { id, userId },
      include: { items: true, sales: { include: { settlements: true } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    // El estado se puede saltar libremente, pero manteniendo UNA verdad
    // con las ventas linkeadas:
    //  - a entregado (sin ventas aun) => se crean las ventas a_liquidar
    //  - salir de entregado (retroceso o cancelacion) => si las ventas no
    //    tienen pagos se borran (la entrega "no ocurrio"); con plata
    //    registrada se bloquea para no romper la contabilidad.
    const sales = (order.sales ?? []) as any[];
    if (status !== 'entregado' && sales.length) {
      if (sales.some(saleHasPayments)) {
        throw new BadRequestException(
          'El pedido tiene pagos registrados: borra esos pagos antes de cambiarle el estado',
        );
      }
      for (const sale of sales) {
        await this.prisma.printSale.delete({ where: { id: sale.id } });
      }
    }
    if (status === 'entregado' && !sales.length) {
      await this.createSalesForOrder(userId, order);
    }

    return this.prisma.printOrder.update({
      where: { id },
      data: { status },
    });
  }

  async deleteOrder(userId: string, id: string) {
    const order = await this.prisma.printOrder.findFirst({
      where: { id, userId },
      include: { sales: { include: { settlements: true } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    const sales = (order.sales ?? []) as any[];
    if (sales.some(saleHasPayments)) {
      throw new BadRequestException(
        'El pedido tiene pagos registrados: borra esos pagos (o las ventas) primero',
      );
    }
    // Ventas sin plata: se van con el pedido (una sola verdad).
    for (const sale of sales) {
      await this.prisma.printSale.delete({ where: { id: sale.id } });
    }
    await this.prisma.printOrder.delete({ where: { id } });
    return true;
  }

  /**
   * Cobra la deuda de un pedido: sin monto cobra TODO lo restante; con
   * monto registra un parcial (recortado a lo adeudado). FIFO entre las
   * ventas del pedido; cada pago pasa por SettlementService (crea el
   * Income con costo prorrateado y actualiza el estado de la venta).
   */
  async payOrder(userId: string, orderId: string, dto: { amount?: number }) {
    const order = await this.prisma.printOrder.findFirst({
      where: { id: orderId, userId },
      include: { sales: { include: { settlements: true } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    const withDebt = (order.sales ?? [])
      .filter((s: any) => s.kind === 'venta')
      .map((s: any) => ({ sale: s, info: this.settlements.settledInfo(s) }))
      .filter((x: any) => x.info.remaining > 0);
    const totalRemaining =
      Math.round(withDebt.reduce((a: number, x: any) => a + x.info.remaining, 0) * 100) /
      100;
    if (totalRemaining <= 0) {
      throw new BadRequestException('El pedido no tiene deuda');
    }

    if (dto.amount !== undefined && (!Number.isFinite(dto.amount) || dto.amount <= 0)) {
      throw new BadRequestException('Monto invalido');
    }
    // Si mando de mas (redondeo), se recorta a lo adeudado.
    let toApply = Math.min(
      dto.amount !== undefined ? Math.round(dto.amount * 100) / 100 : totalRemaining,
      totalRemaining,
    );

    const applied: { saleId: string; amount: number }[] = [];
    for (const { sale, info } of withDebt) {
      if (toApply <= 0) break;
      const take = Math.min(info.remaining, toApply);
      await this.settlements.add(userId, sale.id, { amount: take });
      applied.push({ saleId: sale.id, amount: take });
      toApply = Math.round((toApply - take) * 100) / 100;
    }

    const totalApplied =
      Math.round(applied.reduce((a, x) => a + x.amount, 0) * 100) / 100;
    return {
      applied,
      totalApplied,
      remaining: Math.round((totalRemaining - totalApplied) * 100) / 100,
    };
  }

  // ── Avisos de pago ───────────────────────────────────────

  async getNotices(userId: string, opts?: { includeResolved?: boolean }) {
    return this.prisma.printPaymentNotice.findMany({
      where: {
        userId,
        ...(opts?.includeResolved ? {} : { status: 'pendiente' }),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Confirmar un aviso REGISTRA el pago: sin monto cobra toda la deuda del
   * pedido; con monto, ese parcial. Descartar solo lo archiva. Un aviso de
   * un pedido ya saldado se confirma igual, sin aplicar nada.
   */
  async resolveNotice(
    userId: string,
    id: string,
    status: 'confirmado' | 'descartado',
  ) {
    const notice = await this.prisma.printPaymentNotice.findFirst({
      where: { id, userId },
    });
    if (!notice) throw new NotFoundException('Aviso no encontrado');

    let applied: Awaited<ReturnType<OrdersService['payOrder']>> | null = null;
    if (
      status === 'confirmado' &&
      notice.status === 'pendiente' &&
      notice.orderId
    ) {
      try {
        applied = await this.payOrder(userId, notice.orderId, {
          amount: notice.amount ?? undefined,
        });
      } catch (error) {
        // Pedido sin deuda (aviso redundante o ya cobrado a mano): se
        // confirma igual sin registrar nada.
        if (!(error instanceof BadRequestException)) throw error;
      }
    }

    const updated = await this.prisma.printPaymentNotice.update({
      where: { id },
      data: { status },
    });
    return { ...updated, applied };
  }
}
