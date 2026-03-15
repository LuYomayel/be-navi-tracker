import { Test, TestingModule } from '@nestjs/testing';
import { ActivitiesService } from './activities.service';
import { PrismaService } from '../../config/prisma.service';

describe('ActivitiesService', () => {
  let service: ActivitiesService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockActivity = {
    id: 'activity-1',
    name: 'Exercise',
    icon: 'dumbbell',
    color: '#FF5733',
    days: [true, true, true, true, true, false, false],
    archived: false,
    archivedAt: null,
    userId,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    completions: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        {
          provide: PrismaService,
          useValue: {
            activity: {
              findMany: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getAll', () => {
    it('should return active activities by default', async () => {
      (prisma.activity.findMany as jest.Mock).mockResolvedValue([mockActivity]);

      const result = await service.getAll(userId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Exercise');
      expect(result[0].days).toEqual([true, true, true, true, true, false, false]);
      expect(prisma.activity.findMany).toHaveBeenCalledWith({
        where: { user: { id: userId }, archived: false },
        include: { completions: true },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should return archived activities when archived=true', async () => {
      const archivedActivity = {
        ...mockActivity,
        archived: true,
        archivedAt: new Date(),
      };
      (prisma.activity.findMany as jest.Mock).mockResolvedValue([
        archivedActivity,
      ]);

      const result = await service.getAll(userId, true);

      expect(result).toHaveLength(1);
      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user: { id: userId }, archived: true },
        }),
      );
    });

    it('should return empty array on error', async () => {
      (prisma.activity.findMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.getAll(userId);

      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('should create an activity successfully', async () => {
      (prisma.activity.create as jest.Mock).mockResolvedValue(mockActivity);

      const result = await service.create(
        {
          name: 'Exercise',
          icon: 'dumbbell',
          color: '#FF5733',
          days: [true, true, true, true, true, false, false],
        } as any,
        userId,
      );

      expect(result.name).toBe('Exercise');
      expect(result.days).toEqual([true, true, true, true, true, false, false]);
      expect(prisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId }),
        }),
      );
    });

    it('should throw on database error', async () => {
      (prisma.activity.create as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        service.create({ name: 'Test' } as any, userId),
      ).rejects.toThrow('Error al crear actividad');
    });
  });

  describe('archive', () => {
    it('should set archived=true and archivedAt', async () => {
      const archivedActivity = {
        ...mockActivity,
        archived: true,
        archivedAt: new Date(),
      };
      (prisma.activity.update as jest.Mock).mockResolvedValue(archivedActivity);

      const result = await service.archive('activity-1', userId);

      expect(result).not.toBeNull();
      expect(result!.archived).toBe(true);
      expect(prisma.activity.update).toHaveBeenCalledWith({
        where: { id: 'activity-1', userId },
        data: expect.objectContaining({
          archived: true,
          archivedAt: expect.any(Date),
        }),
      });
    });

    it('should return null on error', async () => {
      (prisma.activity.update as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      );

      const result = await service.archive('nonexistent', userId);

      expect(result).toBeNull();
    });
  });

  describe('restore', () => {
    it('should set archived=false and archivedAt=null', async () => {
      const restoredActivity = {
        ...mockActivity,
        archived: false,
        archivedAt: null,
      };
      (prisma.activity.update as jest.Mock).mockResolvedValue(restoredActivity);

      const result = await service.restore('activity-1', userId);

      expect(result).not.toBeNull();
      expect(result!.archived).toBe(false);
      expect(result!.archivedAt).toBeNull();
      expect(prisma.activity.update).toHaveBeenCalledWith({
        where: { id: 'activity-1', userId },
        data: expect.objectContaining({
          archived: false,
          archivedAt: null,
        }),
      });
    });

    it('should return null on error', async () => {
      (prisma.activity.update as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      );

      const result = await service.restore('nonexistent', userId);

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an activity with userId ownership check', async () => {
      (prisma.activity.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await service.delete('activity-1', userId);

      expect(result).toBe(true);
      expect(prisma.activity.deleteMany).toHaveBeenCalledWith({
        where: { id: 'activity-1', userId },
      });
    });

    it('should return false on error', async () => {
      (prisma.activity.deleteMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.delete('activity-1', userId);

      expect(result).toBe(false);
    });
  });
});
