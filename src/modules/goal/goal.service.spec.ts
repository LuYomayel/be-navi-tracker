import { Test, TestingModule } from '@nestjs/testing';
import { GoalService } from './goal.service';
import { PrismaService } from '../../config/prisma.service';

describe('GoalService', () => {
  let service: GoalService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockGoal = {
    id: 'goal-1',
    userId,
    name: 'Nueva Zelanda + Imprimime 3D',
    description: 'Working Holiday financiado con lámparas 3D',
    targetUsd: 8000,
    currentUsd: 2000,
    startDate: '2026-06-01',
    targetDate: '2028-06-01',
    status: 'active',
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-07'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalService,
        {
          provide: PrismaService,
          useValue: {
            goal: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
            goalContribution: {
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<GoalService>(GoalService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getAll', () => {
    it('should return goals ordered by createdAt desc', async () => {
      (prisma.goal.findMany as jest.Mock).mockResolvedValue([mockGoal]);

      const result = await service.getAll(userId);

      expect(result).toHaveLength(1);
      expect(prisma.goal.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getActive', () => {
    it('should return the most recent active goal', async () => {
      (prisma.goal.findFirst as jest.Mock).mockResolvedValue(mockGoal);

      const result = await service.getActive(userId);

      expect(result).toEqual(mockGoal);
      expect(prisma.goal.findFirst).toHaveBeenCalledWith({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('create', () => {
    it('should create a goal with userId, default currentUsd 0 and default startDate', async () => {
      (prisma.goal.create as jest.Mock).mockResolvedValue(mockGoal);

      const result = await service.create(
        { name: 'Nueva Zelanda', targetUsd: 8000 },
        userId,
      );

      expect(result).toEqual(mockGoal);
      const arg = (prisma.goal.create as jest.Mock).mock.calls[0][0];
      expect(arg.data.userId).toBe(userId);
      expect(arg.data.targetUsd).toBe(8000);
      expect(arg.data.currentUsd).toBe(0);
      expect(arg.data.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('update', () => {
    it('should update with ownership check (updateMany by id + userId)', async () => {
      (prisma.goal.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.update('goal-1', { status: 'paused' }, userId);

      expect(prisma.goal.updateMany).toHaveBeenCalledWith({
        where: { id: 'goal-1', userId },
        data: { status: 'paused' },
      });
    });
  });

  describe('logContribution', () => {
    it('should create a contribution and increment currentUsd on the active goal', async () => {
      (prisma.goal.findFirst as jest.Mock).mockResolvedValue(mockGoal);
      (prisma.goalContribution.create as jest.Mock).mockResolvedValue({
        id: 'c-1',
        amountUsd: 500,
      });
      (prisma.goal.update as jest.Mock).mockResolvedValue({
        ...mockGoal,
        currentUsd: 2500,
      });

      const result = await service.logContribution(userId, {
        amountUsd: 500,
        description: 'venta 2 lámparas',
      });

      expect(result).not.toBeNull();
      const contribArg = (prisma.goalContribution.create as jest.Mock).mock
        .calls[0][0];
      expect(contribArg.data.goalId).toBe('goal-1');
      expect(contribArg.data.userId).toBe(userId);
      expect(contribArg.data.amountUsd).toBe(500);
      expect(contribArg.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(prisma.goal.update).toHaveBeenCalledWith({
        where: { id: 'goal-1' },
        data: { currentUsd: 2500 },
      });
      expect(result!.goal.currentUsd).toBe(2500);
    });

    it('should mark the goal as achieved when reaching the target', async () => {
      (prisma.goal.findFirst as jest.Mock).mockResolvedValue({
        ...mockGoal,
        currentUsd: 7900,
      });
      (prisma.goalContribution.create as jest.Mock).mockResolvedValue({
        id: 'c-2',
      });
      (prisma.goal.update as jest.Mock).mockResolvedValue({
        ...mockGoal,
        currentUsd: 8100,
        status: 'achieved',
      });

      await service.logContribution(userId, { amountUsd: 200 });

      expect(prisma.goal.update).toHaveBeenCalledWith({
        where: { id: 'goal-1' },
        data: { currentUsd: 8100, status: 'achieved' },
      });
    });

    it('should return null when the user has no goal', async () => {
      (prisma.goal.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.logContribution(userId, { amountUsd: 100 });

      expect(result).toBeNull();
      expect(prisma.goalContribution.create).not.toHaveBeenCalled();
      expect(prisma.goal.update).not.toHaveBeenCalled();
    });
  });

  describe('getProgress', () => {
    it('should compute percentage, remaining and daysRemaining', async () => {
      (prisma.goal.findFirst as jest.Mock).mockResolvedValue(mockGoal);

      const result = await service.getProgress(userId);

      expect(result).not.toBeNull();
      expect(result!.percentage).toBeCloseTo(25); // 2000 / 8000
      expect(result!.remainingUsd).toBe(6000);
      expect(typeof result!.daysRemaining).toBe('number');
    });

    it('should cap percentage at 100 and remaining at 0 when over target', async () => {
      (prisma.goal.findFirst as jest.Mock).mockResolvedValue({
        ...mockGoal,
        currentUsd: 9000,
      });

      const result = await service.getProgress(userId);

      expect(result!.percentage).toBe(100);
      expect(result!.remainingUsd).toBe(0);
    });

    it('should return null when the user has no goal', async () => {
      (prisma.goal.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getProgress(userId);

      expect(result).toBeNull();
    });
  });
});
