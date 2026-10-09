import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';
import { XpAction } from '../xp/dto/xp.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { inferProject, resolveProject } from './task-project';
import { ProjectsService } from './projects.service';

/** Relaciones que la UI necesita de cada tarea. */
const TASK_INCLUDE = {
  projectRef: { select: { id: true, name: true, status: true } },
  milestone: { select: { id: true, name: true } },
} as const;

/**
 * Forma de la tarea que ve el cliente: JSON parseado y el proyecto como
 * nombre (lo que filtra el front) + id/estado. `projectRef` no sale.
 */
function serialize(t: any) {
  const { projectRef, ...rest } = t;
  return {
    ...rest,
    tags: t.tags ? JSON.parse(t.tags) : [],
    recurrenceRule: t.recurrenceRule ? JSON.parse(t.recurrenceRule) : null,
    // Sin migrar todavia (project != ""): se infiere como antes.
    project: projectRef?.name ?? (t.project === '' ? null : resolveProject(t)),
    projectId: projectRef?.id ?? t.projectId ?? null,
    projectStatus: projectRef?.status ?? null,
    milestone: t.milestone ?? null,
  };
}

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private xpService: XpService,
    private projects: ProjectsService,
  ) {}

  /**
   * Resuelve proyecto + hito para un create/update. Prioridad: el hito
   * (arrastra su proyecto) > projectId > nombre (app vieja / MCP).
   * Devuelve solo las claves a escribir; {} = no tocar.
   */
  private async resolveLinks(
    userId: string,
    dto: {
      projectId?: string | null;
      project?: string;
      milestoneId?: string | null;
    },
    current?: { projectId: string | null; milestoneId: string | null },
  ): Promise<{ projectId?: string | null; milestoneId?: string | null }> {
    if (dto.milestoneId) {
      const m = await this.projects.ownMilestone(userId, dto.milestoneId);
      return { projectId: m.projectId, milestoneId: m.id };
    }

    let projectId: string | null | undefined;
    if (dto.projectId !== undefined) {
      projectId = dto.projectId
        ? (await this.projects.ownProject(userId, dto.projectId)).id
        : null;
    } else if (dto.project !== undefined) {
      const name = (dto.project ?? '').trim();
      projectId = name
        ? (await this.projects.findOrCreateByName(userId, name)).id
        : null;
    }

    const out: { projectId?: string | null; milestoneId?: string | null } = {};
    if (projectId !== undefined) out.projectId = projectId;
    if (dto.milestoneId === null) out.milestoneId = null;
    // Cambiar de proyecto deja el hito viejo colgado: se saca.
    if (
      projectId !== undefined &&
      current?.milestoneId &&
      projectId !== current.projectId
    ) {
      out.milestoneId = null;
    }
    if (projectId === null) out.milestoneId = null;
    return out;
  }

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
      include: TASK_INCLUDE,
      orderBy: [{ order: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    return tasks.map(serialize);
  }

  async findOne(userId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, userId },
      include: TASK_INCLUDE,
    });
    if (!task) throw new NotFoundException('Task not found');
    return serialize(task);
  }

  async create(userId: string, dto: CreateTaskDto) {
    let links = await this.resolveLinks(userId, dto);
    if (links.projectId === undefined) {
      // Nada elegido: se toma del prefijo del titulo ("Stampia - ...").
      const inferred = inferProject(dto.title);
      links = inferred
        ? {
            projectId: (
              await this.projects.findOrCreateByName(userId, inferred)
            ).id,
          }
        : {};
    }

    const task = await this.prisma.task.create({
      include: TASK_INCLUDE,
      data: {
        ...links,
        project: '', // columna legacy: "" = ya usa projectId
        userId,
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate,
        dueTime: dto.dueTime,
        priority: dto.priority || 'medium',
        status: dto.status || 'pending',
        category: dto.category,
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
    const {
      userId: _uid,
      id: _id,
      createdAt: _c,
      project: _p,
      projectId: _pid,
      milestoneId: _mid,
      ...rest
    } = dto as any;
    const data: any = {
      ...rest,
      ...(await this.resolveLinks(userId, dto, existing)),
    };
    if (dto.project !== undefined) data.project = '';
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
      include: TASK_INCLUDE,
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
      include: TASK_INCLUDE,
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
}
