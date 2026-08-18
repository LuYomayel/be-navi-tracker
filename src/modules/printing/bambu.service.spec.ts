import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BambuService } from './bambu.service';
import { StockService } from './stock.service';
import { PrismaService } from '../../config/prisma.service';

describe('BambuService', () => {
  let service: BambuService;
  let prisma: any;
  let stock: any;

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
              update: jest.fn().mockImplementation(({ data }) =>
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
      ],
    }).compile();

    service = module.get(BambuService);
    prisma = module.get(PrismaService);
    stock = module.get(StockService);
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
      const stored = prisma.printSettings.update.mock.calls[0][0].data.bambuToken;
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
      prisma.printSettings.findUnique.mockResolvedValue({ userId, bambuToken: null });
      await expect(service.sync(userId)).rejects.toThrow(BadRequestException);
    });
  });
});
