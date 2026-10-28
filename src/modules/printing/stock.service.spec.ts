import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StockService } from './stock.service';
import { PrismaService } from '../../config/prisma.service';
import { PartsService } from './parts.service';

describe('StockService', () => {
  let service: StockService;
  let prisma: any;
  let parts: any;
  const baseJob = {
    id: 'job-1',
    userId: 'user-1',
    status: 'ok',
    appliedPlan: [],
  };

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
                Promise.resolve({
                  ...filaments.find((f) => f.id === where.id),
                  ...data,
                }),
              ),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            printProduct: {
              findMany: jest
                .fn()
                .mockResolvedValue([productWithBreakdown, productNoBreakdown]),
              findFirst: jest.fn().mockResolvedValue(productWithBreakdown),
              update: jest
                .fn()
                .mockImplementation(({ data }) =>
                  Promise.resolve({ ...productWithBreakdown, ...data }),
                ),
            },
            printSettings: {
              findUnique: jest.fn().mockResolvedValue(settings),
            },
            printPartMove: { findMany: jest.fn().mockResolvedValue([]) },
            printJob: {
              findMany: jest.fn().mockResolvedValue([]),
              findFirst: jest.fn(),
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({
                  id: 'job-1',
                  stockApplied: false,
                  ...data,
                }),
              ),
              update: jest
                .fn()
                .mockImplementation(({ data }) =>
                  Promise.resolve({ id: 'job-1', ...data }),
                ),
              delete: jest.fn().mockResolvedValue({}),
            },
          },
        },
        {
          provide: PartsService,
          useValue: {
            recomputeJob: jest.fn().mockResolvedValue(null),
            removeJob: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(StockService);
    prisma = module.get(PrismaService);
    parts = module.get(PartsService);
  });

  describe('getStock', () => {
    it('devuelve el stock agrupado por color', async () => {
      const res = await service.getStock(userId);
      expect(res.colors.find((c: any) => c.color === 'negro')!.totalGrams).toBe(
        1080,
      );
      expect(res.colors.find((c: any) => c.color === 'rojo')!.totalGrams).toBe(
        300,
      );
      expect(res.untrackedRolls).toBe(0);
    });
  });

  describe('check', () => {
    it('con desglose por color chequea cada color con desperdicio', async () => {
      // 2 unidades: negro 60x2x1.15=138, rojo 40x2x1.15=92 — alcanza
      const res = await service.check(userId, [
        { productId: 'prod-1', qty: 2 },
      ]);
      expect(res.ok).toBe(true);
      const negro = res.perColor.find((c: any) => c.color === 'negro')!;
      expect(negro.needed).toBeCloseTo(138);
    });

    it('reporta faltantes por color', async () => {
      // 5 unidades de rojo: 40x5x1.15 = 230 <= 300 ok; 20 unidades = 920 > 300
      const res = await service.check(userId, [
        { productId: 'prod-1', qty: 20 },
      ]);
      expect(res.ok).toBe(false);
      const rojo = res.perColor.find((c: any) => c.color === 'rojo')!;
      expect(rojo.missing).toBeCloseTo(620);
    });

    it('producto sin desglose cae al chequeo por gramos totales', async () => {
      const res = await service.check(userId, [
        { productId: 'prod-2', qty: 2 },
      ]);
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
        expect.objectContaining({
          where: { id: 'f1' },
          data: { gramsLeft: 0 },
        }),
      );
      expect(prisma.filament.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'f2' },
          data: { gramsLeft: 880 },
        }),
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
      prisma.filament.findFirst.mockResolvedValue({
        ...filaments[0],
        gramsLeft: 0,
      });

      await service.deleteJob(userId, 'job-1');

      expect(prisma.filament.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'f1' },
          data: { gramsLeft: 80 },
        }),
      );
      expect(prisma.printJob.delete).toHaveBeenCalled();
    });
  });

  describe('reassignJob (corregir el color de una impresion)', () => {
    // La A1 Mini reporto verde (el slot tenia el color viejo) pero era rojo.
    const appliedGreen = {
      id: 'job-1',
      userId,
      status: 'ok',
      stockApplied: true,
      filamentsUsed: [{ colorHex: '00BB31FF', grams: 50 }],
      appliedPlan: [{ filamentId: 'f2', grams: 50 }],
    };

    it('devuelve lo descontado al rollo equivocado y descuenta del color correcto', async () => {
      prisma.printJob.findFirst
        .mockResolvedValueOnce(appliedGreen)
        .mockResolvedValueOnce({
          ...appliedGreen,
          stockApplied: false,
          appliedPlan: null,
          filamentsUsed: [
            { color: 'rojo', grams: 50, reportedHex: '00BB31FF' },
          ],
        });
      prisma.filament.findFirst.mockResolvedValue({
        ...filaments[1],
        gramsLeft: 950,
      });

      const res = await service.reassignJob(userId, 'job-1', [
        { color: 'Rojo' },
      ]);

      expect(prisma.filament.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'f2' },
          data: { gramsLeft: 1000 },
        }),
      );
      expect(prisma.printJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            filamentsUsed: [
              { color: 'rojo', grams: 50, reportedHex: '00BB31FF' },
            ],
            stockApplied: false,
            appliedPlan: [],
          },
        }),
      );
      expect(prisma.filament.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'f3' },
          data: { gramsLeft: 250 },
        }),
      );
      expect(res.applied).toEqual([{ filamentId: 'f3', grams: 50 }]);
    });

    it('una impresion fallida no descuenta y lo avisa (en vez de decir "recalculado")', async () => {
      const failed = {
        ...appliedGreen,
        status: 'fallida',
        stockApplied: false,
        appliedPlan: [],
      };
      prisma.printJob.findFirst.mockResolvedValueOnce(failed);
      const res: any = await service.reassignJob(userId, 'job-1', [
        { color: 'blanco' },
      ]);
      expect(res.notApplied).toBe('fallida');
      expect(res.applied).toEqual([]);
      expect(prisma.filament.update).not.toHaveBeenCalled();
    });

    it('"se imprimio igual": la pasa a ok y descuenta', async () => {
      const failed = {
        ...appliedGreen,
        status: 'fallida',
        stockApplied: false,
        appliedPlan: [],
      };
      prisma.printJob.findFirst
        .mockResolvedValueOnce(failed)
        .mockResolvedValueOnce({
          ...failed,
          status: 'ok',
          filamentsUsed: [
            { color: 'rojo', grams: 50, reportedHex: '00BB31FF' },
          ],
        });
      const res: any = await service.reassignJob(
        userId,
        'job-1',
        [{ color: 'rojo' }],
        {
          markOk: true,
        },
      );
      expect(prisma.printJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ok' }),
        }),
      );
      expect(res.applied).toEqual([{ filamentId: 'f3', grams: 50 }]);
      expect(res.notApplied).toBeUndefined();
    });

    it('se puede elegir el rollo exacto por id', async () => {
      prisma.printJob.findFirst
        .mockResolvedValueOnce(appliedGreen)
        .mockResolvedValueOnce({
          ...appliedGreen,
          stockApplied: false,
          appliedPlan: null,
          filamentsUsed: [{ filamentId: 'f3', grams: 50 }],
        });
      prisma.filament.findFirst.mockResolvedValue({ ...filaments[2] });

      const res = await service.reassignJob(userId, 'job-1', [
        { filamentId: 'f3' },
      ]);
      expect(res.applied).toEqual([{ filamentId: 'f3', grams: 50 }]);
    });

    it('recordar color: el hex reportado pasa a los rollos vivos de ese color y sale de los de otro color', async () => {
      // Bambu reporto 000000 (el slot decia negro) y era rojo, y se marca "recordar".
      const job = {
        ...appliedGreen,
        filamentsUsed: [{ colorHex: '000000FF', grams: 50 }],
      };
      prisma.printJob.findFirst
        .mockResolvedValueOnce(job)
        .mockResolvedValueOnce({
          ...job,
          stockApplied: false,
          appliedPlan: [],
        });
      prisma.filament.findFirst.mockResolvedValue({
        ...filaments[1],
        gramsLeft: 950,
      });

      const res = await service.reassignJob(
        userId,
        'job-1',
        [{ color: 'rojo' }],
        {
          learnHex: true,
        },
      );

      // f1 (Negro #000000) lo pierde; f3 (Rojo) lo gana
      expect(prisma.filament.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['f1'] }, userId },
        data: { colorHex: null },
      });
      expect(prisma.filament.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['f3'] }, userId },
        data: { colorHex: '#000000' },
      });
      expect(res.learned).toEqual([
        { color: 'rojo', hex: '#000000', rolls: 1, removedFrom: ['negro'] },
      ]);
    });

    it('sin recordar color no toca el hex de ningun rollo', async () => {
      prisma.printJob.findFirst
        .mockResolvedValueOnce(appliedGreen)
        .mockResolvedValueOnce({
          ...appliedGreen,
          stockApplied: false,
          appliedPlan: [],
        });
      prisma.filament.findFirst.mockResolvedValue({
        ...filaments[1],
        gramsLeft: 950,
      });
      await service.reassignJob(userId, 'job-1', [{ color: 'rojo' }]);
      expect(prisma.filament.updateMany).not.toHaveBeenCalled();
    });

    it('con varios consumos hay que pasar los gramos de cada uno', async () => {
      prisma.printJob.findFirst.mockResolvedValueOnce({
        ...appliedGreen,
        filamentsUsed: [
          { colorHex: '00BB31FF', grams: 50 },
          { colorHex: '000000FF', grams: 20 },
        ],
      });
      await expect(
        service.reassignJob(userId, 'job-1', [{ color: 'rojo' }]),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.filament.update).not.toHaveBeenCalled();
    });

    it('un color fuera de la paleta no toca el stock', async () => {
      prisma.printJob.findFirst.mockResolvedValueOnce(appliedGreen);
      await expect(
        service.reassignJob(userId, 'job-1', [{ color: 'pla wood' }]),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.filament.update).not.toHaveBeenCalled();
    });

    it('un rollo que no es del usuario tira NotFound sin tocar el stock', async () => {
      prisma.printJob.findFirst.mockResolvedValueOnce(appliedGreen);
      prisma.filament.findFirst.mockResolvedValue(null);
      await expect(
        service.reassignJob(userId, 'job-1', [{ filamentId: 'ajeno' }]),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.filament.update).not.toHaveBeenCalled();
    });
  });

  describe('piezas de la impresion', () => {
    it('al corregir el color, las piezas que sumo la impresion se recalculan', async () => {
      prisma.printJob.findFirst
        .mockResolvedValueOnce({
          ...baseJob,
          stockApplied: false,
          filamentsUsed: [{ colorHex: '00BB31FF', grams: 50 }],
        })
        .mockResolvedValueOnce({
          ...baseJob,
          stockApplied: false,
          filamentsUsed: [{ color: 'rojo', grams: 50 }],
        });
      await service.reassignJob(userId, 'job-1', [{ color: 'rojo' }]);
      expect(parts.recomputeJob).toHaveBeenCalledWith(userId, 'job-1');
    });

    it('borrar la impresion borra las piezas que habia sumado', async () => {
      prisma.printJob.findFirst.mockResolvedValue({
        ...baseJob,
        stockApplied: false,
      });
      await service.deleteJob(userId, 'job-1');
      expect(parts.removeJob).toHaveBeenCalledWith(userId, 'job-1');
    });
  });

  describe('listJobs', () => {
    it('cada impresion trae de que rollo/color desconto y en que impresora fue', async () => {
      prisma.printJob.findMany.mockResolvedValue([
        {
          id: 'job-1',
          notes: 'Impresora 0300GA5A1300999',
          appliedPlan: [{ filamentId: 'f3', grams: 50 }],
        },
        { id: 'job-2', notes: 'Impresora 01P00C542000174', appliedPlan: null },
      ]);
      const jobs = await service.listJobs(userId);
      expect(jobs[0].printer).toBe('A1 Mini');
      expect(jobs[0].deducted).toEqual([
        {
          filamentId: 'f3',
          grams: 50,
          color: 'Rojo',
          brand: 'Grilon3',
          material: 'PLA',
        },
      ]);
      expect(jobs[1].printer).toBe('P1S');
      expect(jobs[1].deducted).toEqual([]);
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
