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
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'sale-x', ...data }),
              ),
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
    it('no deja borrar un pedido con ventas generadas', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({
        ...order,
        sales: [{ id: 'sale-1' }],
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
});
