import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { computeStats } from './project-stats';
import { inferProject } from './task-project';
import {
  CreateMilestoneDto,
  CreateProjectDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
} from './dto/project.dto';

/**
 * Proyectos de tareas y sus hitos.
 *
 * Los nombres se comparan sin mayusculas: la columna usa la collation
 * case-insensitive de MySQL, asi que `where: { name }` ya matchea
 * "PulpoU" con "Pulpou" (y el @@unique tambien los trata como iguales).
 */
@Injectable()
export class ProjectsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(private prisma: PrismaService) {}

  // Las tareas de antes de que existiera la tabla se vinculan solas al
  // levantar. Es idempotente: solo toca tareas con `project` != "".
  async onApplicationBootstrap() {
    try {
      const pending = await this.prisma.task.findMany({
        where: { OR: [{ project: null }, { project: { not: '' } }] },
        select: { userId: true },
        distinct: ['userId'],
      });
      for (const { userId } of pending) {
        const n = await this.migrateLegacy(userId);
        this.logger.log(`Proyectos: ${n} tareas migradas (user ${userId})`);
      }
    } catch (e) {
      this.logger.error('Fallo la migracion de proyectos', e as Error);
    }
  }

  // ── Proyectos ───────────────────────────────────────────────

  async list(userId: string, today: string, includeArchived = false) {
    const projects = await this.prisma.project.findMany({
      where: includeArchived
        ? { userId }
        : { userId, status: { not: 'archived' } },
      include: {
        milestones: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
      },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    if (!projects.length) return [];

    const tasks = await this.prisma.task.findMany({
      where: { userId, projectId: { in: projects.map((p) => p.id) } },
      select: {
        projectId: true,
        milestoneId: true,
        completed: true,
        dueDate: true,
      },
    });

    return projects.map((p) => {
      const own = tasks.filter((t) => t.projectId === p.id);
      return {
        ...p,
        stats: computeStats(own, today),
        milestones: p.milestones.map((m) => ({
          ...m,
          stats: computeStats(
            own.filter((t) => t.milestoneId === m.id),
            today,
          ),
        })),
      };
    });
  }

  async get(userId: string, id: string, today: string) {
    const all = await this.list(userId, today, true);
    const p = all.find((x) => x.id === id);
    if (!p) throw new NotFoundException('Proyecto no encontrado');
    return p;
  }

  async create(userId: string, dto: CreateProjectDto) {
    const name = this.cleanName(dto.name);
    if (await this.findByName(userId, name)) {
      throw new ConflictException(`Ya existe el proyecto "${name}"`);
    }
    return this.prisma.project.create({
      data: {
        userId,
        name,
        emoji: dto.emoji,
        color: dto.color,
        description: dto.description,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateProjectDto) {
    await this.ownProject(userId, id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = this.cleanName(dto.name);
      const clash = await this.findByName(userId, name);
      if (clash && clash.id !== id) {
        throw new ConflictException(`Ya existe el proyecto "${name}"`);
      }
      data.name = name;
    }
    if (dto.emoji !== undefined) data.emoji = dto.emoji || null;
    if (dto.color !== undefined) data.color = dto.color || null;
    if (dto.description !== undefined)
      data.description = dto.description || null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.order !== undefined) data.order = dto.order;
    return this.prisma.project.update({ where: { id }, data });
  }

  /** Las tareas quedan sin proyecto; no se borra ninguna. */
  async remove(userId: string, id: string) {
    await this.ownProject(userId, id);
    await this.prisma.task.updateMany({
      where: { userId, projectId: id },
      data: { projectId: null, milestoneId: null },
    });
    await this.prisma.project.delete({ where: { id } });
    return { deleted: true };
  }

  async findOrCreateByName(userId: string, rawName: string) {
    const name = this.cleanName(rawName);
    const existing = await this.findByName(userId, name);
    if (existing) return existing;
    return this.prisma.project.create({ data: { userId, name } });
  }

  async ownProject(userId: string, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, userId } });
    if (!p) throw new NotFoundException('Proyecto no encontrado');
    return p;
  }

  // ── Hitos ───────────────────────────────────────────────────

  async createMilestone(
    userId: string,
    projectId: string,
    dto: CreateMilestoneDto,
  ) {
    await this.ownProject(userId, projectId);
    return this.prisma.milestone.create({
      data: {
        userId,
        projectId,
        name: this.cleanName(dto.name),
        dueDate: dto.dueDate,
      },
    });
  }

  async updateMilestone(userId: string, id: string, dto: UpdateMilestoneDto) {
    await this.ownMilestone(userId, id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = this.cleanName(dto.name);
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate || null;
    if (dto.done !== undefined) data.done = dto.done;
    if (dto.order !== undefined) data.order = dto.order;
    return this.prisma.milestone.update({ where: { id }, data });
  }

  /** Las tareas del hito siguen en el proyecto, sin hito. */
  async removeMilestone(userId: string, id: string) {
    await this.ownMilestone(userId, id);
    await this.prisma.task.updateMany({
      where: { userId, milestoneId: id },
      data: { milestoneId: null },
    });
    await this.prisma.milestone.delete({ where: { id } });
    return { deleted: true };
  }

  async ownMilestone(userId: string, id: string) {
    const m = await this.prisma.milestone.findFirst({ where: { id, userId } });
    if (!m) throw new NotFoundException('Hito no encontrado');
    return m;
  }

  // ── Compat: pausa por nombre (app movil empaquetada vieja) ──

  async pausedNames(userId: string): Promise<string[]> {
    const ps = await this.prisma.project.findMany({
      where: { userId, status: 'paused' },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    return ps.map((p) => p.name);
  }

  async setPausedByName(userId: string, name: string, paused: boolean) {
    const p = await this.findOrCreateByName(userId, name);
    await this.prisma.project.update({
      where: { id: p.id },
      data: { status: paused ? 'paused' : 'active' },
    });
    return this.pausedNames(userId);
  }

  // ── Migracion de lo anterior a la tabla ─────────────────────

  /**
   * Vincula cada tarea vieja a un Project: el nombre guardado en la columna
   * legacy `project`, o el inferido del prefijo del titulo. Despues deja
   * `project = ""` (= migrada). Tambien pasa los pausados que vivian en
   * UserPreferences al estado del proyecto. Devuelve cuantas tareas toco.
   */
  async migrateLegacy(userId: string): Promise<number> {
    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        OR: [{ project: null }, { project: { not: '' } }],
      },
      select: { id: true, title: true, project: true, projectId: true },
    });

    for (const t of tasks) {
      const name = t.projectId
        ? null
        : t.project?.trim() || inferProject(t.title);
      if (name) {
        const p = await this.findOrCreateByName(userId, name);
        await this.prisma.task.update({
          where: { id: t.id },
          data: { projectId: p.id, project: '' },
        });
      } else {
        await this.prisma.task.update({
          where: { id: t.id },
          data: { project: '' },
        });
      }
    }

    const prefs = await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { pausedTaskProjects: true },
    });
    const paused = Array.isArray(prefs?.pausedTaskProjects)
      ? (prefs!.pausedTaskProjects as unknown[])
      : [];
    for (const name of paused) {
      if (typeof name !== 'string' || !name.trim()) continue;
      const p = await this.findOrCreateByName(userId, name);
      if (p.status !== 'paused') {
        await this.prisma.project.update({
          where: { id: p.id },
          data: { status: 'paused' },
        });
      }
    }

    return tasks.length;
  }

  // ── helpers ─────────────────────────────────────────────────

  private findByName(userId: string, name: string) {
    return this.prisma.project.findFirst({ where: { userId, name } });
  }

  private cleanName(raw: string): string {
    const name = (raw ?? '').trim().slice(0, 40);
    if (!name) throw new BadRequestException('El nombre no puede estar vacio');
    return name;
  }
}
