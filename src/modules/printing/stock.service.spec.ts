import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StockService } from './stock.service';
import { PrismaService } from '../../config/prisma.service';

describe('StockService', () => {
  let service: StockService;
  let prisma: any;

  const userId = 'user-1';

  const filaments = [
    {
      id: 'f1',
      userId,
      color: 'Negro',
      colorHex: '#000000',
      gramsLeft: 80,
      grams: 1000,
      purchasedAt: '2026-07-01',
      discarded: false,
      finishedAt: null,
      brand: 'GST3D',
      material: 'PLA+',
    },
    {
      id: 'f2',
      userId,
      color: 'negro',
      colorHex: null,
      gramsLeft: 1000,
      grams: 1000,
      purchasedAt: '2026-08-01',
      discarded: false,
      finishedAt: null,
      brand: 'Grilon3',
      material: 'PLA',
    },
    {
      id: 'f3',
      userId,
      color: 'Rojo',
      colorHex: '#ff0000',
      gramsLeft: 300,
      grams: 1000,
      purchasedAt: '2026-06-01',
      discarded: false,
      finishedAt: null,
      brand: 'Grilon3',
      material: 'PLA',
    },
  ];

  const settings = {
    userId,
    costPerGram: 20,
    wastePct: 0.15,
    powerPerHour: 12,
    defaultMarkup: 1.3,
  };

  const productWithBreakdown = {
    id: 'prod-1',
    userId,
    name: 'TETRIS',
    grams: 127,
    hours: 4.5,
    active: true,
    colorBreakdown: [
      { color: 'negro', grams: 60 },
      { color: 'rojo', grams: 40 },
    ],
  };

  const productNoBreakdown = {
    id: 'prod-2',
    userId,
    name: 'Caja',
    grams: 200,
    hours: 6,
    active: true,
    colorBreakdown: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        {
          provide: PrismaService,
          useValue: {
            filament: {
              findMany: jest.fn().mockResolvedValue(filaments),
              findFirst: jest.fn(),
              update: jest.fn().mockImplementation(({ where, data }) =>
                Promise.resolve({ ...filaments.find((f) => f.id === where.id), ...data }),
              ),
            },
            printProduct: {
              findMany: jest.fn().mockResolvedValue([productWithBreakdown, productNoBreakdown]),
              findFirst: jest.fn().mockResolvedValue(productWithBreakdown),
              update: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ ...productWithBreakdown, ...data }),
              ),
            },
            printSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
            printJob: {
              findMany: jest.fn().mockResolvedValue([]),
              findFirst: jest.fn(),
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'job-1', stockApplied: false, ...data }),
              ),
              update: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'job-1', ...data }),
              ),
              delete: jest.fn().mockResolvedValue({}),
            },
          },
        },
      ],
    }).compile();

    service = module.get(StockService);
    prisma = module.get(PrismaService);
  });

  describe('getStock', () => {
    it('devuelve el stock agrupado por color', async () => {
      const res = await service.getStock(userId);
      expect(res.colors.find((c: any) => c.color === 'negro')!.totalGrams).toBe(1080);
      expect(res.colors.find((c: any) => c.color === 'rojo')!.totalGrams).toBe(300);
      expect(res.untrackedRolls).toBe(0);
    });
  });

  describe('check', () => {
    it('con desglose por color chequea cada color con desperdicio', async () => {
      // 2 unidades: negro 60x2x1.15=138, rojo 40x2x1.15=92 — alcanza
      const res = await service.check(userId, [{ productId: 'prod-1', qty: 2 }]);
      expect(res.ok).toBe(true);
      const negro = res.perColor.find((c: any) => c.color === 'negro')!;
      expect(negro.needed).toBeCloseTo(138);
    });

    it('reporta faltantes por color', async () => {
      // 5 unidades de rojo: 40x5x1.15 = 230 <= 300 ok; 20 unidades = 920 > 300
      const res = await service.check(userId, [{ productId: 'prod-1', qty: 20 }]);
      expect(res.ok).toBe(false);
      const rojo = res.perColor.find((c: any) => c.color === 'rojo')!;
      expect(rojo.missing).toBeCloseTo(620);
    });

    it('producto sin desglose cae al chequeo por gramos totales', async () => {
      const res = await service.check(userId, [{ productId: 'prod-2', qty: 2 }]);
      // 200x2x1.15 = 460 vs stock total 1380
      expect(res.fallback).toMatchObject({ needed: 460, available: 1380 });
      expect(res.productsWithoutBreakdown).toEqual(['Caja']);
    });

    it('producto inexistente tira NotFound', async () => {
      prisma.printProduct.findMany.mockResolvedValue([]);
      await expect(
        service.check(userId, [{ productId: 'nope', qty: 1 }]),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createJob + apply', () => {
    it('crea la impresion y descuenta el stock FIFO', async () => {
      prisma.printJob.findFirst.mockResolvedValue({
        id: 'job-1',
        userId,
        status: 'ok',
        stockApplied: false,
        filamentsUsed: [{ color: 'negro', grams: 200 }],
      });

      const res = await service.createJob(userId, {
        title: 'TETRIS x2',
        filamentsUsed: [{ color: 'negro', grams: 200 }],
      });

      // f1 (80) se vacia y f2 aporta 120
      expect(prisma.filament.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'f1' }, data: { gramsLeft: 0 } }),
      );
      expect(prisma.filament.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'f2' }, data: { gramsLeft: 880 } }),
      );
      expect(res.applied).toEqual([
        { filamentId: 'f1', grams: 80 },
        { filamentId: 'f2', grams: 120 },
      ]);
      expect(res.unmatchedGrams).toBe(0);
    });

    it('reporta gramos sin match sin romper', async () => {
      prisma.printJob.findFirst.mockResolvedValue({
        id: 'job-1',
        userId,
        status: 'ok',
        stockApplied: false,
        filamentsUsed: [{ color: 'violeta', grams: 50 }],
      });

      const res = await service.createJob(userId, {
        title: 'algo violeta',
        filamentsUsed: [{ color: 'violeta', grams: 50 }],
      });

      expect(res.unmatchedGrams).toBe(50);
      expect(prisma.filament.update).not.toHaveBeenCalled();
    });

    it('no aplica dos veces el mismo job', async () => {
      prisma.printJob.findFirst.mockResolvedValue({
        id: 'job-1',
        userId,
        status: 'ok',
        stockApplied: true,
        filamentsUsed: [{ color: 'negro', grams: 100 }],
      });
      await expect(service.applyJob(userId, 'job-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('dos entradas del mismo color no descuentan el mismo gramo dos veces', async () => {
      prisma.printJob.findFirst.mockResolvedValue({
        id: 'job-1',
        userId,
        status: 'ok',
        stockApplied: false,
        filamentsUsed: [
          { color: 'negro', grams: 80 },
          { color: 'negro', grams: 50 },
        ],
      });

      const res = await service.createJob(userId, {
        title: 'doble negro',
        filamentsUsed: [
          { color: 'negro', grams: 80 },
          { color: 'negro', grams: 50 },
        ],
      });

      // La primera vacia f1 (80); la segunda tiene que salir de f2, no de f1.
      expect(res.applied).toEqual([
        { filamentId: 'f1', grams: 80 },
        { filamentId: 'f2', grams: 50 },
      ]);
    });
  });

  describe('deleteJob', () => {
    it('revierte el stock descontado', async () => {
      prisma.printJob.findFirst.mockResolvedValue({
        id: 'job-1',
        userId,
        stockApplied: true,
        appliedPlan: [{ filamentId: 'f1', grams: 80 }],
      });
      prisma.filament.findFirst.mockResolvedValue({ ...filaments[0], gramsLeft: 0 });

      await service.deleteJob(userId, 'job-1');

      expect(prisma.filament.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'f1' }, data: { gramsLeft: 80 } }),
      );
      expect(prisma.printJob.delete).toHaveBeenCalled();
    });
  });

  describe('learnBreakdown', () => {
    it('guarda el consumo por color del job en el producto (por unidad)', async () => {
      prisma.printJob.findFirst.mockResolvedValue({
        id: 'job-1',
        userId,
        productId: 'prod-1',
        filamentsUsed: [
          { color: 'negro', grams: 120 },
          { color: 'rojo', grams: 80 },
        ],
      });

      await service.learnBreakdown(userId, 'job-1', 2);

      expect(prisma.printProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            colorBreakdown: [
              { color: 'negro', colorHex: null, grams: 60 },
              { color: 'rojo', colorHex: null, grams: 40 },
            ],
          }),
        }),
      );
    });

    it('job sin producto linkeado tira BadRequest', async () => {
      prisma.printJob.findFirst.mockResolvedValue({
        id: 'job-1',
        userId,
        productId: null,
        filamentsUsed: [{ color: 'negro', grams: 100 }],
      });
      await expect(service.learnBreakdown(userId, 'job-1', 1)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('finishFilament', () => {
    it('marca el rollo agotado con fecha y stock 0', async () => {
      prisma.filament.findFirst.mockResolvedValue(filaments[0]);

      await service.finishFilament(userId, 'f1', '2026-08-18');

      expect(prisma.filament.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'f1' },
          data: { gramsLeft: 0, finishedAt: '2026-08-18' },
        }),
      );
    });

    it('rollo inexistente tira NotFound', async () => {
      prisma.filament.findFirst.mockResolvedValue(null);
      await expect(service.finishFilament(userId, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
