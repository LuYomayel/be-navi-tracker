import { Test, TestingModule } from '@nestjs/testing';
import { PhysicalActivitiesService } from './physical-activities.service';
import { PrismaService } from '../../config/prisma.service';
import { AICostService } from '../ai-cost/ai-cost.service';

describe('PhysicalActivitiesService', () => {
  let service: PhysicalActivitiesService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockActivity = {
    id: 'pa-1',
    userId,
    date: '2024-01-15',
    steps: 8000,
    distanceKm: 5.2,
    activeEnergyKcal: 350,
    exerciseMinutes: 45,
    standHours: 10,
    screenshotUrl: null,
    source: 'manual',
    aiConfidence: null,
    context: null,
    aiCostUsd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhysicalActivitiesService,
        {
          provide: PrismaService,
          useValue: {
            physicalActivity: {
              findMany: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
        {
          provide: AICostService,
          useValue: {
            logFromCompletion: jest.fn(),
            calculateCost: jest.fn().mockReturnValue(0),
          },
        },
      ],
    }).compile();

    service = module.get<PhysicalActivitiesService>(
      PhysicalActivitiesService,
    );
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getAll', () => {
    it('should return all physical activities for user', async () => {
      (prisma.physicalActivity.findMany as jest.Mock).mockResolvedValue([
        mockActivity,
      ]);

      const result = await service.getAll(userId);

      expect(result).toHaveLength(1);
      expect(result[0].steps).toBe(8000);
      expect(prisma.physicalActivity.findMany).toHaveBeenCalledWith({
        where: { user: { id: userId } },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should return empty array on error', async () => {
      (prisma.physicalActivity.findMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.getAll(userId);

      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('should create a physical activity with userId', async () => {
      (prisma.physicalActivity.create as jest.Mock).mockResolvedValue(
        mockActivity,
      );

      const data = {
        date: '2024-01-15',
        steps: 8000,
        distanceKm: 5.2,
        activeEnergyKcal: 350,
        exerciseMinutes: 45,
        standHours: 10,
        source: 'manual',
      };

      const result = await service.create(data as any, userId);

      expect(result).toBeDefined();
      expect(result.steps).toBe(8000);
      expect(prisma.physicalActivity.create).toHaveBeenCalledWith({
        data: { ...data, userId },
      });
    });

    it('should throw on database error', async () => {
      (prisma.physicalActivity.create as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        service.create({ date: '2024-01-15' } as any, userId),
      ).rejects.toThrow('Error al crear actividad física');
    });
  });

  describe('update', () => {
    it('should update a physical activity with ownership check', async () => {
      const updated = { ...mockActivity, steps: 10000 };
      (prisma.physicalActivity.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.update(
        'pa-1',
        { steps: 10000 } as any,
        userId,
      );

      expect(result).not.toBeNull();
      expect(result!.steps).toBe(10000);
      expect(prisma.physicalActivity.update).toHaveBeenCalledWith({
        where: { id: 'pa-1', userId },
        data: expect.objectContaining({ steps: 10000 }),
      });
    });

    it('should return null on error', async () => {
      (prisma.physicalActivity.update as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      );

      const result = await service.update(
        'nonexistent',
        { steps: 10000 } as any,
        userId,
      );

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete with ownership check and return true', async () => {
      (prisma.physicalActivity.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const result = await service.delete('pa-1', userId);

      expect(result).toBe(true);
      expect(prisma.physicalActivity.deleteMany).toHaveBeenCalledWith({
        where: { id: 'pa-1', userId },
      });
    });

    it('should return false on error', async () => {
      (prisma.physicalActivity.deleteMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.delete('pa-1', userId);

      expect(result).toBe(false);
    });
  });
});
