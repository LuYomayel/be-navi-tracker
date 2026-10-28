import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BambuService } from './bambu.service';
import { StockService } from './stock.service';
import { PartsService } from './parts.service';
import { PrismaService } from '../../config/prisma.service';

describe('BambuService', () => {
  let service: BambuService;
  let prisma: any;
  let stock: any;
  let parts: any;

  const userId = 'user-1';
  const rawToken = 'bambu-token-123';

  const task = {
    id: 987,
    title: 'TETRIS_x2.3mf',
    deviceId: 'P1S-serial',
    status: 2,
    startTime: '2026-08-16T14:00:00Z',
    endTime: '2026-08-16T18:30:00Z',
    weight: 260,
    costTime: 16200,
    amsDetailMapping: [
      { ams: 0, targetColor: '000000FF', filamentType: 'PLA', weight: 180 },
      { ams: 1, targetColor: 'FF0000FF', filamentType: 'PLA', weight: 80 },
    ],
  };

  beforeEach(async () => {
    global.fetch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BambuService,
        {
          provide: PrismaService,
          useValue: {
            printSettings: {
              findUnique: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
              update: jest
                .fn()
                .mockImplementation(({ data }) =>
                  Promise.resolve({ userId, ...data }),
                ),
            },
            printJob: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
        {
          provide: StockService,
          useValue: {
            createJob: jest.fn().mockResolvedValue({
              job: { id: 'job-1' },
              applied: [],
              unmatchedGrams: 0,
            }),
          },
        },
        {
          provide: PartsService,
          useValue: { applyTemplate: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(BambuService);
    prisma = module.get(PrismaService);
    stock = module.get(StockService);
    parts = module.get(PartsService);
  });

  describe('connect', () => {
    it('verifica el token contra la API y lo guarda encriptado', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ total: 0, hits: [] }),
      });

      await service.connect(userId, { token: rawToken });

      const updateArg = prisma.printSettings.update.mock.calls[0][0];
      expect(updateArg.data.bambuToken).toBeTruthy();
      expect(updateArg.data.bambuToken).not.toContain(rawToken);
      expect(updateArg.data.bambuLastSyncAt).toBeInstanceOf(Date);
    });

    it('token rechazado por Bambu tira BadRequest', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401 });
      await expect(service.connect(userId, { token: 'malo' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.printSettings.update).not.toHaveBeenCalled();
    });
  });

  describe('sync', () => {
    beforeEach(async () => {
      // conectar de verdad para tener un token encriptado valido
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total: 0, hits: [] }),
      });
      await service.connect(userId, { token: rawToken });
      const stored =
        prisma.printSettings.update.mock.calls[0][0].data.bambuToken;
      prisma.printSettings.findUnique.mockResolvedValue({
        userId,
        bambuToken: stored,
        bambuRegion: 'global',
        bambuLastSyncAt: new Date('2026-08-15T00:00:00Z'),
      });
    });

    it('importa impresiones nuevas con consumo por color y descuenta stock', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ total: 1, hits: [task] }),
      });

      const res = await service.sync(userId);

      expect(stock.createJob).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          source: 'bambu',
          externalId: 'bambu:987',
          title: 'TETRIS_x2.3mf',
          grams: 260,
          filamentsUsed: [
            { colorHex: '000000FF', grams: 180, color: undefined },
            { colorHex: 'FF0000FF', grams: 80, color: undefined },
          ],
        }),
      );
      expect(res.created).toBe(1);
    });

    it('si la placa tiene plantilla de piezas, la aplica sola (con repeticiones y placa incompleta)', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          total: 1,
          hits: [{ ...task, repetitions: 2, skipObjects: [3, 4] }],
        }),
      });
      await service.sync(userId);
      expect(parts.applyTemplate).toHaveBeenCalledWith(userId, 'job-1', {
        multiplier: 2,
        partial: true,
      });
    });

    it('guarda el identificador de la placa: designId:plateIndex', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          total: 1,
          hits: [{ ...task, designId: 2868821, plateIndex: 8 }],
        }),
      });
      await service.sync(userId);
      expect(stock.createJob).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ plateKey: '2868821:8' }),
      );
    });

    it('sin designId (envio sin diseño) usa el titulo + la placa', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          total: 1,
          hits: [{ ...task, designId: 0, plateIndex: 3 }],
        }),
      });
      await service.sync(userId);
      expect(stock.createJob).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ plateKey: 't:TETRIS_x2.3mf:3' }),
      );
    });

    it('una impresion EN CURSO (status 4) no se importa todavia', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ total: 1, hits: [{ ...task, status: 4 }] }),
      });
      const res = await service.sync(userId);
      expect(stock.createJob).not.toHaveBeenCalled();
      expect(res.pending).toBe(1);
    });

    it('una impresion larga que arranco antes del ultimo sync se importa al terminar', async () => {
      prisma.printSettings.findUnique.mockResolvedValue({
        ...(await prisma.printSettings.findUnique()),
        bambuLastSyncAt: new Date('2026-08-16T18:00:00Z'), // arranco 14:00, termino 18:30
      });
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ total: 1, hits: [task] }),
      });
      await service.sync(userId);
      expect(stock.createJob).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ apply: undefined }),
      );
    });

    it('una cancelada/fallida se registra como fallida sin descontar', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ total: 1, hits: [{ ...task, status: 3 }] }),
      });
      await service.sync(userId);
      expect(stock.createJob).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ status: 'fallida', apply: false }),
      );
      expect(parts.applyTemplate).not.toHaveBeenCalled();
    });

    it('no reimporta tareas ya sincronizadas', async () => {
      prisma.printJob.findMany.mockResolvedValue([{ externalId: 'bambu:987' }]);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ total: 1, hits: [task] }),
      });

      const res = await service.sync(userId);

      expect(stock.createJob).not.toHaveBeenCalled();
      expect(res.created).toBe(0);
      expect(res.skipped).toBe(1);
    });

    it('tareas anteriores a la conexion no descuentan stock', async () => {
      const oldTask = { ...task, id: 5, startTime: '2026-08-01T10:00:00Z' };
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ total: 1, hits: [oldTask] }),
      });

      await service.sync(userId, { importHistory: true });

      expect(stock.createJob).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ apply: false }),
      );
    });

    it('sin token tira BadRequest', async () => {
      prisma.printSettings.findUnique.mockResolvedValue({
        userId,
        bambuToken: null,
      });
      await expect(service.sync(userId)).rejects.toThrow(BadRequestException);
    });
  });
});
