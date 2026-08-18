import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { PrismaService } from '../../config/prisma.service';
import { GoalService } from '../goal/goal.service';

describe('SettlementService', () => {
  let service: SettlementService;
  let prisma: any;
  let goal: any;

  const userId = 'user-1';

  // Venta de 5 unidades a $2.000: total $10.000, costo total $5.000.
  const baseSale = {
    id: 'sale-1',
    userId,
    date: '2026-08-10',
    productId: 'prod-1',
    kind: 'venta',
    qty: 5,
    chargedUnit: 2000,
    costUnit: 1000,
    status: 'a_liquidar',
    incomeId: null,
    settlements: [] as any[],
    product: { id: 'prod-1', name: 'TETRIS' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementService,
        {
          provide: PrismaService,
          useValue: {
            printSale: {
              findFirst: jest.fn(),
              update: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ ...baseSale, ...data }),
              ),
            },
            printSaleSettlement: {
              findFirst: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'st-1', createdAt: new Date(), ...data }),
              ),
              delete: jest.fn(),
            },
            income: {
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'inc-1', ...data }),
              ),
              delete: jest.fn().mockResolvedValue({}),
            },
          },
        },
        {
          provide: GoalService,
          useValue: { getActive: jest.fn().mockResolvedValue({ id: 'goal-1' }) },
        },
      ],
    }).compile();

    service = module.get(SettlementService);
    prisma = module.get(PrismaService);
    goal = module.get(GoalService);
  });

  describe('add', () => {
    it('sin monto liquida todo lo restante y deja la venta liquidada', async () => {
      prisma.printSale.findFirst.mockResolvedValue({ ...baseSale });

      const res = await service.add(userId, 'sale-1', {});

      expect(prisma.income.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 10000,
            cost: 5000,
            source: '3d',
            goalId: 'goal-1',
          }),
        }),
      );
      expect(prisma.printSale.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'liquidado' }) }),
      );
      expect(res.settlement.amount).toBe(10000);
    });

    it('con monto parcial deja la venta parcial y prorratea el costo', async () => {
      prisma.printSale.findFirst.mockResolvedValue({ ...baseSale });

      await service.add(userId, 'sale-1', { amount: 6000 });

      // 6000 de 10000 = 60% => costo prorrateado 3000
      expect(prisma.income.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 6000, cost: 3000 }),
        }),
      );
      expect(prisma.printSale.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'parcial' }) }),
      );
    });

    it('con qty calcula el monto (3 de 5 unidades)', async () => {
      prisma.printSale.findFirst.mockResolvedValue({ ...baseSale });

      const res = await service.add(userId, 'sale-1', { qty: 3 });

      expect(res.settlement.amount).toBe(6000);
      expect(res.settlement.qty).toBe(3);
    });

    it('el segundo pago que completa el total deja la venta liquidada', async () => {
      prisma.printSale.findFirst.mockResolvedValue({
        ...baseSale,
        status: 'parcial',
        settlements: [{ id: 'st-0', amount: 6000 }],
      });

      await service.add(userId, 'sale-1', { amount: 4000 });

      expect(prisma.printSale.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'liquidado' }) }),
      );
    });

    it('rechaza un monto que excede lo restante', async () => {
      prisma.printSale.findFirst.mockResolvedValue({
        ...baseSale,
        status: 'parcial',
        settlements: [{ id: 'st-0', amount: 6000 }],
      });

      await expect(service.add(userId, 'sale-1', { amount: 5000 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.income.create).not.toHaveBeenCalled();
    });

    it('rechaza liquidar una muestra', async () => {
      prisma.printSale.findFirst.mockResolvedValue({
        ...baseSale,
        kind: 'muestra',
        chargedUnit: 0,
      });

      await expect(service.add(userId, 'sale-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza una venta legacy ya liquidada (incomeId sin settlements)', async () => {
      prisma.printSale.findFirst.mockResolvedValue({
        ...baseSale,
        status: 'liquidado',
        incomeId: 'inc-legacy',
      });

      await expect(service.add(userId, 'sale-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('venta inexistente tira NotFound', async () => {
      prisma.printSale.findFirst.mockResolvedValue(null);
      await expect(service.add(userId, 'nope', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('settledInfo', () => {
    it('venta legacy liquidada cuenta como totalmente cobrada', () => {
      const info = service.settledInfo({
        ...baseSale,
        status: 'liquidado',
        incomeId: 'inc-legacy',
        settlements: [],
      } as any);
      expect(info).toEqual({ total: 10000, settledAmount: 10000, remaining: 0 });
    });

    it('suma los settlements y calcula lo restante', () => {
      const info = service.settledInfo({
        ...baseSale,
        settlements: [{ amount: 6000 }, { amount: 1000 }],
      } as any);
      expect(info).toEqual({ total: 10000, settledAmount: 7000, remaining: 3000 });
    });
  });

  describe('remove', () => {
    it('borra el pago con su income y recomputa el estado', async () => {
      prisma.printSaleSettlement.findFirst.mockResolvedValue({
        id: 'st-1',
        userId,
        saleId: 'sale-1',
        amount: 4000,
        incomeId: 'inc-1',
      });
      prisma.printSale.findFirst.mockResolvedValue({
        ...baseSale,
        status: 'liquidado',
        settlements: [{ id: 'st-1', amount: 4000 }, { id: 'st-2', amount: 6000 }],
      });

      await service.remove(userId, 'st-1');

      expect(prisma.income.delete).toHaveBeenCalledWith({ where: { id: 'inc-1' } });
      expect(prisma.printSaleSettlement.delete).toHaveBeenCalledWith({
        where: { id: 'st-1' },
      });
      // quedaba st-2 con 6000 de 10000 => parcial
      expect(prisma.printSale.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'parcial' }) }),
      );
    });

    it('pago inexistente tira NotFound', async () => {
      prisma.printSaleSettlement.findFirst.mockResolvedValue(null);
      await expect(service.remove(userId, 'nope')).rejects.toThrow(NotFoundException);
    });
  });
});
