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
    const [orders, sales] = await Promise.all([
      this.prisma.printOrder.findMany({
        where: { userId: settings.userId },
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      // Deuda: solo las ventas nacidas de pedidos del link (no la feria).
      this.prisma.printSale.findMany({
        where: { userId: settings.userId, orderId: { not: null }, kind: 'venta' },
        include: { settlements: true },
      }),
    ]);
    const debt = sales.reduce(
      (a: number, s: any) => a + this.settlements.settledInfo(s).remaining,
      0,
    );
    return {
      orders: orders.map((o: any) => this.toPublicOrder(o)),
      debt: Math.round(debt * 100) / 100,
    };
  }

  /** Solo lo que Marcelito tiene que ver de su pedido (nunca costos). */
  private toPublicOrder(order: any) {
    const items = (order.items ?? []).map((i: any) => ({
      productId: i.productId,
      name: i.product?.name ?? 'producto',
      qty: i.qty,
      unitPrice: i.unitPrice,
      subtotal: i.qty * i.unitPrice,
    }));
    return {
      id: order.id,
      customerName: order.customerName,
      status: order.status,
      notes: order.notes,
      createdAt: order.createdAt,
      items,
      total: items.reduce((a: number, i: any) => a + i.subtotal, 0),
    };
  }

  async createPaymentNotice(token: string, dto: CreatePaymentNoticeDto) {
    const settings = await this.settingsByToken(token);
    if (dto.amount !== undefined && (!Number.isFinite(dto.amount) || dto.amount <= 0)) {
      throw new BadRequestException('Monto invalido');
    }
    if (!dto.amount && !dto.message?.trim()) {
      throw new BadRequestException('Falta el monto o un mensaje');
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
      include: { items: true, sales: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    // Entregado = el pedido se convierte en ventas reales (una por item),
    // una sola vez. Los precios son el snapshot del momento del pedido.
    if (status === 'entregado' && !(order.sales ?? []).length) {
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
          product && settings
            ? pricingForProduct(product, settings).cost
            : 0;
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

    return this.prisma.printOrder.update({
      where: { id },
      data: { status },
    });
  }

  async deleteOrder(userId: string, id: string) {
    const order = await this.prisma.printOrder.findFirst({
      where: { id, userId },
      include: { sales: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if ((order.sales ?? []).length) {
      throw new BadRequestException(
        'El pedido ya genero ventas: borralas primero si hace falta',
      );
    }
    await this.prisma.printOrder.delete({ where: { id } });
    return true;
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

  async resolveNotice(
    userId: string,
    id: string,
    status: 'confirmado' | 'descartado',
  ) {
    const notice = await this.prisma.printPaymentNotice.findFirst({
      where: { id, userId },
    });
    if (!notice) throw new NotFoundException('Aviso no encontrado');
    return this.prisma.printPaymentNotice.update({
      where: { id },
      data: { status },
    });
  }
}
