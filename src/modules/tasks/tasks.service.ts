import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';
import { XpAction } from '../xp/dto/xp.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private xpService: XpService,
  ) {}

  async findAll(
    userId: string,
    filters: {
      date?: string;
      status?: string;
      category?: string;
      from?: string;
      to?: string;
    },
  ) {
    const where: any = { userId };

    if (filters.date) {
      where.dueDate = filters.date;
    }
    if (filters.from && filters.to) {
      where.dueDate = { gte: filters.from, lte: filters.to };
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.category) {
      where.category = filters.category;
    }

    const tasks = await this.prisma.task.findMany({
      where,
      orderBy: [
        { order: 'asc' },
        { dueDate: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    // Parse JSON fields
    return tasks.map((t) => ({
      ...t,
      tags: t.tags ? JSON.parse(t.tags) : [],
      recurrenceRule: t.recurrenceRule ? JSON.parse(t.recurrenceRule) : null,
    }));
  }

  async findOne(userId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, userId },
    });
    if (!task) throw new NotFoundException('Task not found');
    return {
      ...task,
      tags: task.tags ? JSON.parse(task.tags) : [],
      recurrenceRule: task.recurrenceRule
        ? JSON.parse(task.recurrenceRule)
        : null,
    };
  }

  async create(userId: string, dto: CreateTaskDto) {
    const task = await this.prisma.task.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate,
        dueTime: dto.dueTime,
        priority: dto.priority || 'medium',
        category: dto.category,
        tags: dto.tags ? JSON.stringify(dto.tags) : null,
        isRecurring: dto.isRecurring || false,
        recurrenceRule: dto.recurrenceRule
          ? JSON.stringify(dto.recurrenceRule)
          : null,
      },
    });

    return {
      ...task,
      tags: task.tags ? JSON.parse(task.tags) : [],
      recurrenceRule: task.recurrenceRule
        ? JSON.parse(task.recurrenceRule)
        : null,
    };
  }

  async update(userId: string, id: string, dto: UpdateTaskDto) {
    const existing = await this.prisma.task.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Task not found');

    const data: any = { ...dto };
    if (dto.tags) data.tags = JSON.stringify(dto.tags);
    if (dto.recurrenceRule)
      data.recurrenceRule = JSON.stringify(dto.recurrenceRule);

    // If completing, set completedAt
    if (dto.completed === true && !existing.completed) {
      data.completedAt = new Date();
      data.status = 'completed';
    }
    if (dto.completed === false) {
      data.completedAt = null;
      data.status = 'pending';
    }

    const task = await this.prisma.task.update({
      where: { id },
      data,
    });

    return {
      ...task,
      tags: task.tags ? JSON.parse(task.tags) : [],
      recurrenceRule: task.recurrenceRule
        ? JSON.parse(task.recurrenceRule)
        : null,
    };
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.task.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Task not found');

    await this.prisma.task.delete({ where: { id } });
    return { deleted: true };
  }

  async toggle(userId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, userId },
    });
    if (!task) throw new NotFoundException('Task not found');

    const nowCompleted = !task.completed;

    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        completed: nowCompleted,
        completedAt: nowCompleted ? new Date() : null,
        status: nowCompleted ? 'completed' : 'pending',
      },
    });

    // Award XP on completion
    if (nowCompleted) {
      const xpAmount =
        task.priority === 'urgent'
          ? 20
          : task.priority === 'high'
            ? 15
            : 10;
      await this.xpService.addXp(userId, {
        action: XpAction.TASK_COMPLETE,
        xpAmount,
        description: `Tarea completada: ${task.title}`,
        metadata: { taskId: id, priority: task.priority },
      });
    }

    return {
      ...updated,
      tags: updated.tags ? JSON.parse(updated.tags) : [],
      recurrenceRule: updated.recurrenceRule
        ? JSON.parse(updated.recurrenceRule)
        : null,
    };
  }

  async reorder(userId: string, taskIds: string[]) {
    const updates = taskIds.map((id, index) =>
      this.prisma.task.updateMany({
        where: { id, userId },
        data: { order: index },
      }),
    );
    await this.prisma.$transaction(updates);
    return { reordered: true };
  }
}
