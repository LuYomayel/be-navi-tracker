import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SweatTestService } from './sweat-test.service';
import { PrismaService } from '../../config/prisma.service';

describe('SweatTestService', () => {
  let service: SweatTestService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      sweatTest: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
      userPreferences: { findFirst: jest.fn() },
      weightEntry: { findFirst: jest.fn() },
      physicalActivity: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SweatTestService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SweatTestService>(SweatTestService);
  });

  describe('create', () => {
    it('guarda el test con los resultados ya calculados', async () => {
      prisma.sweatTest.create.mockImplementation(({ data }) => ({
        id: 'st-1',
        ...data,
      }));

      const res = await service.create('user-1', {
        date: '2026-08-05',
        activity: 'handball',
        durationMin: 120,
        weightBeforeKg: 82,
        weightAfterKg: 80.5,
        fluidIntakeMl: 700,
        indoor: true,
      });

      expect(res.sweatMl).toBe(2200);
      expect(res.sweatRateMlPerHour).toBe(1100);
      expect(res.pctBodyWeightLost).toBeCloseTo(1.83, 2);
      expect(res.level).toBe('sed');
      expect(prisma.sweatTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1', sweatMl: 2200 }),
        }),
      );
    });

    it('rechaza datos imposibles con 400', async () => {
      await expect(
        service.create('user-1', {
          date: '2026-08-05',
          durationMin: 120,
          weightBeforeKg: 80,
          weightAfterKg: 82,
          fluidIntakeMl: 0,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.sweatTest.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('devuelve los tests del usuario, del mas nuevo al mas viejo', async () => {
      prisma.sweatTest.findMany.mockResolvedValue([{ id: 'st-1' }]);
      const res = await service.findAll('user-1');
      expect(res).toHaveLength(1);
      expect(prisma.sweatTest.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { date: 'desc' },
      });
    });
  });

  describe('remove', () => {
    it('no deja borrar un test de otro usuario', async () => {
      prisma.sweatTest.findFirst.mockResolvedValue(null);
      await expect(service.remove('user-1', 'st-ajeno')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.sweatTest.delete).not.toHaveBeenCalled();
    });

    it('borra el test propio', async () => {
      prisma.sweatTest.findFirst.mockResolvedValue({ id: 'st-1' });
      prisma.sweatTest.delete.mockResolvedValue({ id: 'st-1' });
      await service.remove('user-1', 'st-1');
      expect(prisma.sweatTest.delete).toHaveBeenCalledWith({
        where: { id: 'st-1' },
      });
    });
  });

  describe('getStats', () => {
    it('promedia la tasa de sudoracion de todos los tests', async () => {
      prisma.sweatTest.findMany.mockResolvedValue([
        { sweatRateMlPerHour: 1000, indoor: true, date: '2026-08-05' },
        { sweatRateMlPerHour: 1400, indoor: true, date: '2026-08-03' },
        { sweatRateMlPerHour: 900, indoor: false, date: '2026-08-01' },
      ]);
      const stats = await service.getStats('user-1');
      expect(stats.count).toBe(3);
      expect(stats.avgRateMlPerHour).toBe(1100);
      expect(stats.maxRateMlPerHour).toBe(1400);
      expect(stats.minRateMlPerHour).toBe(900);
      expect(stats.indoorAvgMlPerHour).toBe(1200);
      expect(stats.outdoorAvgMlPerHour).toBe(900);
    });

    it('sin tests devuelve count 0 y sin promedio', async () => {
      prisma.sweatTest.findMany.mockResolvedValue([]);
      const stats = await service.getStats('user-1');
      expect(stats.count).toBe(0);
      expect(stats.avgRateMlPerHour).toBeNull();
    });
  });

  describe('getRecommendation', () => {
    beforeEach(() => {
      prisma.userPreferences.findFirst.mockResolvedValue({
        currentWeight: 82,
        takesCreatine: true,
        hydrationGoalGlasses: 8,
        hydrationMlPerGlass: 250,
      });
      prisma.sweatTest.findMany.mockResolvedValue([
        { sweatRateMlPerHour: 1100, indoor: true, date: '2026-08-05' },
      ]);
    });

    it('usa la tasa medida y el peso del usuario', async () => {
      const rec = await service.getRecommendation('user-1', 2);
      expect(rec.trainingDay.drinkMl).toBe(4781);
      expect(rec.restDay.drinkMl).toBe(2551);
      expect(rec.estimated).toBe(false);
      expect(rec.weightKg).toBe(82);
    });

    it('cae al peso del ultimo pesaje si preferences no lo tiene', async () => {
      prisma.userPreferences.findFirst.mockResolvedValue({
        takesCreatine: false,
      });
      prisma.weightEntry.findFirst.mockResolvedValue({ weight: 80 });
      const rec = await service.getRecommendation('user-1', 2);
      expect(rec.weightKg).toBe(80);
      expect(rec.trainingDay.creatineMl).toBe(0);
    });

    it('sin tests marca la recomendacion como estimada', async () => {
      prisma.sweatTest.findMany.mockResolvedValue([]);
      const rec = await service.getRecommendation('user-1', 2);
      expect(rec.estimated).toBe(true);
      expect(rec.sweatRateMlPerHour).toBe(1000);
    });

    it('sin peso registrado no puede recomendar', async () => {
      prisma.userPreferences.findFirst.mockResolvedValue({});
      prisma.weightEntry.findFirst.mockResolvedValue(null);
      await expect(service.getRecommendation('user-1', 2)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('compara contra la meta actual de la app', async () => {
      const rec = await service.getRecommendation('user-1', 2);
      expect(rec.currentGoalMl).toBe(2000);
      expect(rec.gapTrainingMl).toBe(2781); // le falta esto los dias que entrena
    });
  });
});
