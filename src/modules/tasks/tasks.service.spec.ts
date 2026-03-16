import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';

describe('TasksService', () => {
  let service: TasksService;
  let prisma: PrismaService;
  let xpService: XpService;

  const userId = 'user-1';

  const mockTask = {
    id: 'task-1',
    userId,
    title: 'Test task',
    description: 'A description',
    dueDate: '2026-03-16',
    dueTime: '10:00',
    priority: 'medium',
    status: 'pending',
    completed: false,
    completedAt: null,
    category: 'work',
    tags: '["tag1","tag2"]',
    order: 0,
    isRecurring: false,
    recurrenceRule: null,
    createdAt: new Date('2026-03-16'),
    updatedAt: new Date('2026-03-16'),
  };

  const mockTaskNoTags = {
    ...mockTask,
    id: 'task-2',
    tags: null,
    recurrenceRule: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: PrismaService,
          useValue: {
            task: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: XpService,
          useValue: {
            addXp: jest.fn().mockResolvedValue({
              newLevel: 1,
              xpEarned: 10,
              totalXpEarned: 10,
              leveledUp: false,
              nextLevelXp: 100,
              streak: 0,
              streakBonus: 0,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    prisma = module.get<PrismaService>(PrismaService);
    xpService = module.get<XpService>(XpService);
  });

  describe('findAll', () => {
    it('should return tasks with parsed JSON fields', async () => {
      (prisma.task.findMany as jest.Mock).mockResolvedValue([mockTask]);

      const result = await service.findAll(userId, {});

      expect(result).toHaveLength(1);
      expect(result[0].tags).toEqual(['tag1', 'tag2']);
      expect(result[0].recurrenceRule).toBeNull();
    });

    it('should handle null tags gracefully', async () => {
      (prisma.task.findMany as jest.Mock).mockResolvedValue([mockTaskNoTags]);

      const result = await service.findAll(userId, {});

      expect(result[0].tags).toEqual([]);
    });

    it('should filter by date', async () => {
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll(userId, { date: '2026-03-16' });

      expect(prisma.task.findMany).toHaveBeenCalledWith({
        where: { userId, dueDate: '2026-03-16' },
        orderBy: [{ order: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      });
    });

    it('should filter by date range', async () => {
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll(userId, { from: '2026-03-01', to: '2026-03-31' });

      expect(prisma.task.findMany).toHaveBeenCalledWith({
        where: { userId, dueDate: { gte: '2026-03-01', lte: '2026-03-31' } },
        orderBy: [{ order: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      });
    });

    it('should filter by status and category', async () => {
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll(userId, { status: 'pending', category: 'work' });

      expect(prisma.task.findMany).toHaveBeenCalledWith({
        where: { userId, status: 'pending', category: 'work' },
        orderBy: [{ order: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      });
    });
  });

  describe('findOne', () => {
    it('should return a task with parsed fields', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockTask);

      const result = await service.findOne(userId, 'task-1');

      expect(result.id).toBe('task-1');
      expect(result.tags).toEqual(['tag1', 'tag2']);
    });

    it('should throw NotFoundException if not found', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne(userId, 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create a task with default priority', async () => {
      (prisma.task.create as jest.Mock).mockResolvedValue(mockTask);

      const result = await service.create(userId, { title: 'Test task' });

      expect(result.title).toBe('Test task');
      expect(prisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          title: 'Test task',
          priority: 'medium',
          isRecurring: false,
        }),
      });
    });

    it('should stringify tags and recurrenceRule', async () => {
      (prisma.task.create as jest.Mock).mockResolvedValue({
        ...mockTask,
        tags: '["a","b"]',
        recurrenceRule: '{"frequency":"daily"}',
      });

      await service.create(userId, {
        title: 'Recurring',
        tags: ['a', 'b'],
        isRecurring: true,
        recurrenceRule: { frequency: 'daily' } as any,
      });

      expect(prisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tags: '["a","b"]',
          recurrenceRule: '{"frequency":"daily"}',
          isRecurring: true,
        }),
      });
    });
  });

  describe('update', () => {
    it('should update a task', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockTask);
      (prisma.task.update as jest.Mock).mockResolvedValue({
        ...mockTask,
        title: 'Updated',
      });

      const result = await service.update(userId, 'task-1', {
        title: 'Updated',
      });

      expect(result.title).toBe('Updated');
    });

    it('should throw NotFoundException if not found', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.update(userId, 'non-existent', { title: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set completedAt and status when completing', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockTask);
      (prisma.task.update as jest.Mock).mockResolvedValue({
        ...mockTask,
        completed: true,
        status: 'completed',
      });

      await service.update(userId, 'task-1', { completed: true });

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          completed: true,
          completedAt: expect.any(Date),
          status: 'completed',
        }),
      });
    });

    it('should clear completedAt when uncompleting', async () => {
      const completedTask = { ...mockTask, completed: true };
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(completedTask);
      (prisma.task.update as jest.Mock).mockResolvedValue({
        ...mockTask,
        completed: false,
      });

      await service.update(userId, 'task-1', { completed: false });

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          completed: false,
          completedAt: null,
          status: 'pending',
        }),
      });
    });
  });

  describe('remove', () => {
    it('should delete a task', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockTask);
      (prisma.task.delete as jest.Mock).mockResolvedValue(mockTask);

      const result = await service.remove(userId, 'task-1');

      expect(result).toEqual({ deleted: true });
      expect(prisma.task.delete).toHaveBeenCalledWith({
        where: { id: 'task-1' },
      });
    });

    it('should throw NotFoundException if not found', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.remove(userId, 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('toggle', () => {
    it('should toggle from pending to completed and award XP', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockTask);
      (prisma.task.update as jest.Mock).mockResolvedValue({
        ...mockTask,
        completed: true,
        status: 'completed',
        tags: '["tag1","tag2"]',
      });

      const result = await service.toggle(userId, 'task-1');

      expect(result.completed).toBe(true);
      expect(xpService.addXp).toHaveBeenCalledWith(userId, {
        action: 'task_complete',
        xpAmount: 10,
        description: 'Tarea completada: Test task',
        metadata: { taskId: 'task-1', priority: 'medium' },
      });
    });

    it('should toggle from completed to pending without XP', async () => {
      const completedTask = { ...mockTask, completed: true };
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(completedTask);
      (prisma.task.update as jest.Mock).mockResolvedValue({
        ...mockTask,
        completed: false,
        tags: '["tag1","tag2"]',
      });

      const result = await service.toggle(userId, 'task-1');

      expect(result.completed).toBe(false);
      expect(xpService.addXp).not.toHaveBeenCalled();
    });

    it('should award 20 XP for urgent tasks', async () => {
      const urgentTask = { ...mockTask, priority: 'urgent' };
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(urgentTask);
      (prisma.task.update as jest.Mock).mockResolvedValue({
        ...urgentTask,
        completed: true,
        tags: '["tag1","tag2"]',
      });

      await service.toggle(userId, 'task-1');

      expect(xpService.addXp).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ xpAmount: 20 }),
      );
    });

    it('should award 15 XP for high priority tasks', async () => {
      const highTask = { ...mockTask, priority: 'high' };
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(highTask);
      (prisma.task.update as jest.Mock).mockResolvedValue({
        ...highTask,
        completed: true,
        tags: '["tag1","tag2"]',
      });

      await service.toggle(userId, 'task-1');

      expect(xpService.addXp).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ xpAmount: 15 }),
      );
    });

    it('should award 10 XP for low priority tasks', async () => {
      const lowTask = { ...mockTask, priority: 'low' };
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(lowTask);
      (prisma.task.update as jest.Mock).mockResolvedValue({
        ...lowTask,
        completed: true,
        tags: '["tag1","tag2"]',
      });

      await service.toggle(userId, 'task-1');

      expect(xpService.addXp).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ xpAmount: 10 }),
      );
    });

    it('should throw NotFoundException if not found', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.toggle(userId, 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reorder', () => {
    it('should reorder tasks using transaction', async () => {
      (prisma.$transaction as jest.Mock).mockResolvedValue([]);

      const result = await service.reorder(userId, ['task-1', 'task-2', 'task-3']);

      expect(result).toEqual({ reordered: true });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Verify updateMany was called for each task
      expect(prisma.task.updateMany).toHaveBeenCalledTimes(3);
      expect(prisma.task.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', userId },
        data: { order: 0 },
      });
      expect(prisma.task.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-2', userId },
        data: { order: 1 },
      });
      expect(prisma.task.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-3', userId },
        data: { order: 2 },
      });
    });
  });
});
