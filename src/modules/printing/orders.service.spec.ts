import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { SettlementService } from './settlement.service';
import { PrismaService } from '../../config/prisma.service';
import { GoalService } from '../goal/goal.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: any;

  const userId = 'user-1';
  const token = 'token-abc';

  const settings = {
    id: 's1',
    userId,
    costPerGram: 20,
    wastePct: 0.15,
    powerPerHour: 12,
    defaultMarkup: 1.3,
    publicToken: token,
    financingSurcharge: 0,
  };

  // 127g x $20 x 1.15 + 4.5h x $12 = 2975 -> 3000; x1.3 = 3900
  const product = {
    id: 'prod-1',
    userId,
    name: 'TETRIS',
    grams: 127,
    hours: 4.5,
    markupOverride: null,
    active: true,
    colorsLabel: '7',
    publicPrice: 11000,
  };

  const order = {
    id: 'order-1',
    userId,
    customerName: 'Marcelito',
    status: 'pedido',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [
      { id: 'it-1', orderId: 'order-1', productId: 'prod-1', qty: 5, unitPrice: 3900, product },
    ],
    sales: [] as any[],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        SettlementService,
        {
          provide: PrismaService,
          useValue: {
            printSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
            printProduct: { findMany: jest.fn().mockResolvedValue([product]) },
            printOrder: {
              findMany: jest.fn().mockResolvedValue([order]),
              findFirst: jest.fn(),
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ ...order, ...data, items: order.items }),
              ),
              update: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ ...order, ...data }),
              ),
              delete: jest.fn().mockResolvedValue({}),
            },
            printSale: {
              findMany: jest.fn().mockResolvedValue([]),
              findFirst: jest.fn(),
              delete: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'sale-x', ...data }),
              ),
              update: jest.fn().mockImplementation(({ where, data }) =>
                Promise.resolve({ id: where.id, ...data }),
              ),
            },
            printSaleSettlement: {
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'st-1', createdAt: new Date(), ...data }),
              ),
            },
            income: {
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'inc-1', ...data }),
              ),
              delete: jest.fn().mockResolvedValue({}),
            },
            printOrderItem: {
              deleteMany: jest.fn().mockResolvedValue({}),
              createMany: jest.fn().mockResolvedValue({}),
            },
            printPaymentNotice: {
              findMany: jest.fn().mockResolvedValue([]),
              findFirst: jest.fn(),
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'not-1', status: 'pendiente', ...data }),
              ),
              update: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'not-1', ...data }),
              ),
            },
          },
        },
        { provide: GoalService, useValue: { getActive: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get(OrdersService);
    prisma = module.get(PrismaService);
  });

  describe('createPublicOrder', () => {
    it('token invalido tira NotFound', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(null);
      await expect(
        service.createPublicOrder('nope', { items: [{ productId: 'prod-1', qty: 1 }] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('sin items tira BadRequest', async () => {
      await expect(service.createPublicOrder(token, { items: [] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('producto inexistente o inactivo tira BadRequest', async () => {
      prisma.printProduct.findMany.mockResolvedValue([]);
      await expect(
        service.createPublicOrder(token, { items: [{ productId: 'prod-x', qty: 1 }] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('crea el pedido con snapshot del precio a Marcelito', async () => {
      await service.createPublicOrder(token, {
        items: [{ productId: 'prod-1', qty: 5 }],
        notes: 'para el finde',
      });

      expect(prisma.printOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            status: 'pedido',
            items: {
              create: [
                expect.objectContaining({ productId: 'prod-1', qty: 5, unitPrice: 3900 }),
              ],
            },
          }),
        }),
      );
    });

    it('cantidad invalida tira BadRequest', async () => {
      await expect(
        service.createPublicOrder(token, { items: [{ productId: 'prod-1', qty: 0 }] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateStatus', () => {
    it('estado invalido tira BadRequest', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({ ...order });
      await expect(
        service.updateStatus(userId, 'order-1', 'volando' as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('marcar entregado crea una venta a_liquidar por item', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({ ...order, status: 'listo' });

      await service.updateStatus(userId, 'order-1', 'entregado');

      expect(prisma.printSale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'prod-1',
            qty: 5,
            chargedUnit: 3900,
            status: 'a_liquidar',
            orderId: 'order-1',
          }),
        }),
      );
    });

    it('no duplica ventas si el pedido ya tiene', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({
        ...order,
        status: 'entregado',
        sales: [{ id: 'sale-1' }],
      });

      await service.updateStatus(userId, 'order-1', 'entregado');

      expect(prisma.printSale.create).not.toHaveBeenCalled();
    });
  });

  describe('deleteOrder', () => {
    it('no deja borrar un pedido cuyas ventas ya tienen pagos', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({
        ...order,
        sales: [
          {
            id: 'sale-1',
            kind: 'venta',
            settlements: [{ id: 'st-1', amount: 5000 }],
            incomeId: null,
          },
        ],
      });
      await expect(service.deleteOrder(userId, 'order-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('payment notices', () => {
    it('crea el aviso desde el link publico', async () => {
      await service.createPaymentNotice(token, {
        orderId: 'order-1',
        amount: 11700,
        message: 'te pague 3 tetris',
      });
      expect(prisma.printPaymentNotice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId, amount: 11700 }),
        }),
      );
    });

    it('resolve marca confirmado o descartado', async () => {
      prisma.printPaymentNotice.findFirst.mockResolvedValue({
        id: 'not-1',
        userId,
        status: 'pendiente',
      });
      await service.resolveNotice(userId, 'not-1', 'confirmado');
      expect(prisma.printPaymentNotice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'confirmado' } }),
      );
    });
  });

  describe('getPublicOrders', () => {
    it('devuelve pedidos con total por pedido', async () => {
      const res = await service.getPublicOrders(token);
      expect(res.orders[0].total).toBe(19500); // 5 x 3900
    });
  });

  // ── Cobros sobre pedidos (payOrder + confirmar aviso) ──────

  const deliveredSale = {
    id: 'sale-1',
    userId,
    date: '2026-08-18',
    productId: 'prod-1',
    product,
    kind: 'venta',
    qty: 5,
    chargedUnit: 3900,
    costUnit: 3000,
    status: 'a_liquidar',
    incomeId: null,
    orderId: 'order-1',
    settlements: [] as any[],
    createdAt: new Date('2026-08-18'),
  };

  const deliveredOrder = {
    ...order,
    status: 'entregado',
    sales: [deliveredSale],
  };

  describe('payOrder', () => {
    it('sin monto cobra toda la deuda del pedido y la venta queda liquidada', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({ ...deliveredOrder });
      prisma.printSale.findFirst.mockResolvedValue({ ...deliveredSale });

      const res = await service.payOrder(userId, 'order-1', {});

      expect(res.totalApplied).toBe(19500);
      expect(res.remaining).toBe(0);
      expect(prisma.income.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 19500, source: '3d' }),
        }),
      );
      expect(prisma.printSale.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'liquidado' }),
        }),
      );
    });

    it('con monto parcial cobra ese monto y reporta lo que sigue debiendo', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({ ...deliveredOrder });
      prisma.printSale.findFirst.mockResolvedValue({ ...deliveredSale });

      const res = await service.payOrder(userId, 'order-1', { amount: 11700 });

      expect(res.totalApplied).toBe(11700);
      expect(res.remaining).toBe(7800);
    });

    it('con un parcial previo, sin monto cobra la diferencia', async () => {
      const partial = {
        ...deliveredSale,
        status: 'parcial',
        settlements: [{ id: 'st-0', amount: 11700 }],
      };
      prisma.printOrder.findFirst.mockResolvedValue({
        ...deliveredOrder,
        sales: [partial],
      });
      prisma.printSale.findFirst.mockResolvedValue({ ...partial });

      const res = await service.payOrder(userId, 'order-1', {});

      expect(res.totalApplied).toBe(7800);
      expect(res.remaining).toBe(0);
    });

    it('un monto mayor a la deuda se recorta a lo adeudado', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({ ...deliveredOrder });
      prisma.printSale.findFirst.mockResolvedValue({ ...deliveredSale });

      const res = await service.payOrder(userId, 'order-1', { amount: 999999 });

      expect(res.totalApplied).toBe(19500);
    });

    it('pedido sin deuda tira BadRequest', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({
        ...deliveredOrder,
        sales: [
          { ...deliveredSale, status: 'liquidado', incomeId: 'inc-legacy' },
        ],
      });
      await expect(service.payOrder(userId, 'order-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resolveNotice (confirmado = registra el pago)', () => {
    it('confirmar un aviso sin monto cobra toda la deuda del pedido', async () => {
      prisma.printPaymentNotice.findFirst.mockResolvedValue({
        id: 'not-1',
        userId,
        orderId: 'order-1',
        amount: null,
        status: 'pendiente',
      });
      prisma.printOrder.findFirst.mockResolvedValue({ ...deliveredOrder });
      prisma.printSale.findFirst.mockResolvedValue({ ...deliveredSale });

      const res = await service.resolveNotice(userId, 'not-1', 'confirmado');

      expect(prisma.income.create).toHaveBeenCalled();
      expect(res.applied?.totalApplied).toBe(19500);
      expect(prisma.printPaymentNotice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'confirmado' } }),
      );
    });

    it('confirmar un aviso con monto cobra ese monto', async () => {
      prisma.printPaymentNotice.findFirst.mockResolvedValue({
        id: 'not-1',
        userId,
        orderId: 'order-1',
        amount: 11700,
        status: 'pendiente',
      });
      prisma.printOrder.findFirst.mockResolvedValue({ ...deliveredOrder });
      prisma.printSale.findFirst.mockResolvedValue({ ...deliveredSale });

      const res = await service.resolveNotice(userId, 'not-1', 'confirmado');

      expect(res.applied?.totalApplied).toBe(11700);
    });

    it('descartar NO registra nada', async () => {
      prisma.printPaymentNotice.findFirst.mockResolvedValue({
        id: 'not-1',
        userId,
        orderId: 'order-1',
        amount: null,
        status: 'pendiente',
      });

      await service.resolveNotice(userId, 'not-1', 'descartado');

      expect(prisma.income.create).not.toHaveBeenCalled();
    });

    it('confirmar un aviso de un pedido ya pagado no rompe (queda confirmado sin aplicar)', async () => {
      prisma.printPaymentNotice.findFirst.mockResolvedValue({
        id: 'not-1',
        userId,
        orderId: 'order-1',
        amount: null,
        status: 'pendiente',
      });
      prisma.printOrder.findFirst.mockResolvedValue({
        ...deliveredOrder,
        sales: [
          { ...deliveredSale, status: 'liquidado', incomeId: 'inc-legacy' },
        ],
      });

      const res = await service.resolveNotice(userId, 'not-1', 'confirmado');

      expect(res.applied).toBeNull();
      expect(prisma.income.create).not.toHaveBeenCalled();
    });
  });

  describe('createPaymentNotice sin campos', () => {
    it('con solo el orderId vale como "pague todo el pedido"', async () => {
      await service.createPaymentNotice(token, { orderId: 'order-1' });
      expect(prisma.printPaymentNotice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderId: 'order-1', amount: null }),
        }),
      );
    });

    it('sin orderId, monto ni mensaje se rechaza', async () => {
      await expect(service.createPaymentNotice(token, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── CRUD del lado de Luciano ───────────────────────────────

  describe('createOrder (manual del dueno)', () => {
    it('crea el pedido con el precio a Marcelito como default', async () => {
      await service.createOrder(userId, {
        items: [{ productId: 'prod-1', qty: 3 }],
        notes: 'lo pidio por whatsapp',
      });
      expect(prisma.printOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'pedido',
            items: {
              create: [
                expect.objectContaining({ productId: 'prod-1', qty: 3, unitPrice: 3900 }),
              ],
            },
          }),
        }),
      );
    });

    it('respeta un precio manual por item', async () => {
      await service.createOrder(userId, {
        items: [{ productId: 'prod-1', qty: 1, unitPrice: 5000 }],
      });
      expect(prisma.printOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: { create: [expect.objectContaining({ unitPrice: 5000 })] },
          }),
        }),
      );
    });

    it('crearlo directamente entregado genera las ventas', async () => {
      prisma.printOrder.create.mockResolvedValue({
        ...order,
        id: 'order-9',
        status: 'entregado',
        sales: [],
      });
      await service.createOrder(userId, {
        items: [{ productId: 'prod-1', qty: 2 }],
        status: 'entregado',
      });
      expect(prisma.printSale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderId: 'order-9', qty: 5 }),
        }),
      );
    });

    it('sin items tira BadRequest', async () => {
      await expect(service.createOrder(userId, { items: [] })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('updateOrder', () => {
    it('edita cliente y notas siempre', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({ ...order, sales: [] });
      await service.updateOrder(userId, 'order-1', {
        customerName: 'Marce',
        notes: 'apurado',
      });
      expect(prisma.printOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ customerName: 'Marce', notes: 'apurado' }),
        }),
      );
    });

    it('edita los items mientras no haya ventas generadas', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({ ...order, sales: [] });
      await service.updateOrder(userId, 'order-1', {
        items: [{ productId: 'prod-1', qty: 10 }],
      });
      expect(prisma.printOrderItem.deleteMany).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
      });
      expect(prisma.printOrderItem.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ qty: 10, unitPrice: 3900 })],
        }),
      );
    });

    it('con ventas generadas no deja tocar los items (la venta es la verdad)', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({
        ...order,
        status: 'entregado',
        sales: [{ id: 'sale-1' }],
      });
      await expect(
        service.updateOrder(userId, 'order-1', {
          items: [{ productId: 'prod-1', qty: 1 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateStatus con salto libre y coherencia con las ventas', () => {
    it('retroceder desde entregado sin pagos borra las ventas del pedido', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({
        ...order,
        status: 'entregado',
        sales: [
          { id: 'sale-1', kind: 'venta', status: 'a_liquidar', incomeId: null, settlements: [] },
        ],
      });

      await service.updateStatus(userId, 'order-1', 'imprimiendo');

      expect(prisma.printSale.delete).toHaveBeenCalledWith({ where: { id: 'sale-1' } });
    });

    it('retroceder con pagos registrados se bloquea', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({
        ...order,
        status: 'entregado',
        sales: [
          {
            id: 'sale-1',
            kind: 'venta',
            status: 'parcial',
            incomeId: null,
            settlements: [{ id: 'st-1', amount: 5000 }],
          },
        ],
      });

      await expect(
        service.updateStatus(userId, 'order-1', 'listo'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.printSale.delete).not.toHaveBeenCalled();
    });

    it('cancelar un pedido entregado sin pagos tambien limpia las ventas', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({
        ...order,
        status: 'entregado',
        sales: [
          { id: 'sale-1', kind: 'venta', status: 'a_liquidar', incomeId: null, settlements: [] },
        ],
      });

      await service.updateStatus(userId, 'order-1', 'cancelado');

      expect(prisma.printSale.delete).toHaveBeenCalledWith({ where: { id: 'sale-1' } });
    });
  });

  describe('deleteOrder con ventas', () => {
    it('borra el pedido junto con sus ventas sin pagos', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({
        ...order,
        status: 'entregado',
        sales: [
          { id: 'sale-1', kind: 'venta', status: 'a_liquidar', incomeId: null, settlements: [] },
        ],
      });

      await service.deleteOrder(userId, 'order-1');

      expect(prisma.printSale.delete).toHaveBeenCalledWith({ where: { id: 'sale-1' } });
      expect(prisma.printOrder.delete).toHaveBeenCalledWith({ where: { id: 'order-1' } });
    });

    it('con pagos registrados se bloquea', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({
        ...order,
        status: 'entregado',
        sales: [
          {
            id: 'sale-1',
            kind: 'venta',
            status: 'liquidado',
            incomeId: 'inc-legacy',
            settlements: [],
          },
        ],
      });

      await expect(service.deleteOrder(userId, 'order-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.printOrder.delete).not.toHaveBeenCalled();
    });
  });

  describe('estado de pago en las vistas', () => {
    it('el pedido publico entregado expone paid/due/paymentStatus', async () => {
      prisma.printOrder.findMany.mockResolvedValue([
        {
          ...deliveredOrder,
          sales: [
            {
              ...deliveredSale,
              status: 'parcial',
              settlements: [{ id: 'st-0', amount: 11700 }],
            },
          ],
        },
      ]);
      prisma.printPaymentNotice.findMany.mockResolvedValue([]);

      const res = await service.getPublicOrders(token);

      expect(res.orders[0]).toMatchObject({
        paid: 11700,
        due: 7800,
        paymentStatus: 'parcial',
        noticePending: false,
      });
    });

    it('marca noticePending cuando hay un aviso sin resolver de ese pedido', async () => {
      prisma.printOrder.findMany.mockResolvedValue([{ ...deliveredOrder }]);
      prisma.printPaymentNotice.findMany.mockResolvedValue([
        { id: 'not-1', orderId: 'order-1', status: 'pendiente' },
      ]);

      const res = await service.getPublicOrders(token);

      expect(res.orders[0].noticePending).toBe(true);
    });
  });
});
