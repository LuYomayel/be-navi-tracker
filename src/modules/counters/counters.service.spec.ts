import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CountersService } from './counters.service';
import { PrismaService } from '../../config/prisma.service';

describe('CountersService', () => {
  let service: CountersService;
  const prisma = {
    dailyCounter: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const userId = 'user-1';
  const date = '2026-11-16';

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CountersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CountersService);
  });

  describe('getDay', () => {
    it('devuelve los contadores del día como mapa key → valor, sólo del usuario', async () => {
      prisma.dailyCounter.findMany.mockResolvedValue([
        { key: 'ventas-mensajes', value: 3 },
        { key: 'otro', value: 1 },
      ]);
      await expect(service.getDay(userId, date)).resolves.toEqual({
        'ventas-mensajes': 3,
        otro: 1,
      });
      expect(prisma.dailyCounter.findMany).toHaveBeenCalledWith({
        where: { userId, date },
        select: { key: true, value: true },
      });
    });

    it('rechaza una fecha mal formada', async () => {
      await expect(service.getDay(userId, '16/11/2026')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('adjust', () => {
    it('suma al valor actual y lo guarda (upsert por usuario+día+key)', async () => {
      prisma.dailyCounter.findUnique.mockResolvedValue({ value: 2 });
      prisma.dailyCounter.upsert.mockResolvedValue({ key: 'ventas-mensajes', value: 3 });

      await expect(
        service.adjust(userId, date, 'ventas-mensajes', 1),
      ).resolves.toEqual({ key: 'ventas-mensajes', value: 3 });

      expect(prisma.dailyCounter.upsert).toHaveBeenCalledWith({
        where: { userId_date_key: { userId, date, key: 'ventas-mensajes' } },
        create: { userId, date, key: 'ventas-mensajes', value: 3 },
        update: { value: 3 },
        select: { key: true, value: true },
      });
    });

    it('arranca de 0 si no existía', async () => {
      prisma.dailyCounter.findUnique.mockResolvedValue(null);
      prisma.dailyCounter.upsert.mockResolvedValue({ key: 'k', value: 1 });
      await service.adjust(userId, date, 'k', 1);
      expect(prisma.dailyCounter.upsert.mock.calls[0][0].create.value).toBe(1);
    });

    it('nunca baja de 0', async () => {
      prisma.dailyCounter.findUnique.mockResolvedValue({ value: 0 });
      prisma.dailyCounter.upsert.mockResolvedValue({ key: 'k', value: 0 });
      await service.adjust(userId, date, 'k', -1);
      expect(prisma.dailyCounter.upsert.mock.calls[0][0].update.value).toBe(0);
    });

    it('rechaza keys raras y deltas no enteros', async () => {
      await expect(service.adjust(userId, date, 'Ventas Mensajes!', 1)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.adjust(userId, date, 'k', 1.5)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.dailyCounter.upsert).not.toHaveBeenCalled();
    });
  });
});
