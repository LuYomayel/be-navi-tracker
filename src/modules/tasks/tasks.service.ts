import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';
import { XpAction } from '../xp/dto/xp.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import {
  inferProject,
  normalizeProject,
  projectKey,
  resolveProject,
} from './task-project';

/** Forma de la tarea que ve el cliente: JSON parseado y proyecto resuelto. */
function serialize<
  T extends {
    tags: string | null;
    recurrenceRule: string | null;
    project?: string | null;
    title: string;
  },
>(t: T) {
  return {
    ...t,
    tags: t.tags ? JSON.parse(t.tags) : [],
    recurrenceRule: t.recurrenceRule ? JSON.parse(t.recurrenceRule) : null,
    project: resolveProject(t),
  };
}

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
      orderBy: [{ order: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    return tasks.map(serialize);
  }

  async findOne(userId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, userId },
    });
    if (!task) throw new NotFoundException('Task not found');
    return serialize(task);
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
        // Se persiste el inferido: si despues cambia el titulo, el proyecto queda.
        project: normalizeProject(dto.project) ?? inferProject(dto.title),
        tags: dto.tags ? JSON.stringify(dto.tags) : null,
        isRecurring: dto.isRecurring || false,
        recurrenceRule: dto.recurrenceRule
          ? JSON.stringify(dto.recurrenceRule)
          : null,
      },
    });

    return serialize(task);
  }

  async update(userId: string, id: string, dto: UpdateTaskDto) {
    const existing = await this.prisma.task.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Task not found');

    // El where ya matcheo por dueño, pero los campos de identidad no se editan
    // nunca: un userId en el payload reasignaria la tarea a otra cuenta. El
    // ValidationPipe ya los filtra por HTTP; esto cubre a quien llame al
    // service directo (las tools del MCP, por ejemplo).
    const { userId: _uid, id: _id, createdAt: _c, ...rest } = dto as any;
    const data: any = { ...rest };
    if (dto.tags) data.tags = JSON.stringify(dto.tags);
    if (dto.project !== undefined) data.project = normalizeProject(dto.project);
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

    return serialize(task);
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
        task.priority === 'urgent' ? 20 : task.priority === 'high' ? 15 : 10;
      await this.xpService.addXp(userId, {
        action: XpAction.TASK_COMPLETE,
        xpAmount,
        description: `Tarea completada: ${task.title}`,
        metadata: { taskId: id, priority: task.priority },
      });
    }

    return serialize(updated);
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

  // ── Proyectos pausados ──────────────────────────────────────
  // Viven en UserPreferences (y no en localStorage) para que pausar un
  // proyecto en la web tambien lo esconda en la app del celu.

  async getPausedProjects(userId: string): Promise<string[]> {
    const prefs = await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { pausedTaskProjects: true },
    });
    const list = prefs?.pausedTaskProjects;
    return Array.isArray(list)
      ? (list as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
  }

  async setProjectPaused(
    userId: string,
    project: string,
    paused: boolean,
  ): Promise<string[]> {
    const name = project.trim();
    const current = await this.getPausedProjects(userId);
    const rest = current.filter((p) => projectKey(p) !== projectKey(name));
    const already = rest.length !== current.length;
    const next = paused ? (already ? current : [...current, name]) : rest;

    await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, pausedTaskProjects: next },
      update: { pausedTaskProjects: next },
    });
    return next;
  }
}
