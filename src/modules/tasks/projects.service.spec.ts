import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../../config/prisma.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: any;

  const userId = 'user-1';
  const project = {
    id: 'p1',
    userId,
    name: 'EaseTrain',
    emoji: null,
    color: null,
    description: null,
    status: 'active',
    order: 0,
    milestones: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        {
          provide: PrismaService,
          useValue: {
            project: {
              findMany: jest.fn().mockResolvedValue([]),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
            },
            milestone: {
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            task: {
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
            userPreferences: { findUnique: jest.fn() },
            $transaction: jest.fn((ops) => Promise.all(ops)),
          },
        },
      ],
    }).compile();

    service = module.get(ProjectsService);
    prisma = module.get(PrismaService);
  });

  describe('list', () => {
    it('devuelve proyectos no archivados con sus stats y los de cada hito', async () => {
      prisma.project.findMany.mockResolvedValue([
        { ...project, milestones: [{ id: 'm1', name: 'v2', done: false }] },
      ]);
      prisma.task.findMany.mockResolvedValue([
        { projectId: 'p1', milestoneId: 'm1', completed: true, dueDate: null },
        { projectId: 'p1', milestoneId: null, completed: false, dueDate: null },
      ]);

      const [p] = await service.list(userId, '2026-10-09');

      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, status: { not: 'archived' } },
        }),
      );
      expect(p.stats.total).toBe(2);
      expect(p.stats.done).toBe(1);
      expect(p.milestones[0].stats.total).toBe(1);
      expect(p.milestones[0].stats.done).toBe(1);
    });

    it('con includeArchived trae tambien los archivados', async () => {
      await service.list(userId, '2026-10-09', true);
      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId } }),
      );
    });
  });

  describe('create', () => {
    it('crea con el nombre recortado', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      prisma.project.create.mockResolvedValue(project);

      await service.create(userId, { name: '  EaseTrain ', emoji: '🏋️' });

      expect(prisma.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          name: 'EaseTrain',
          emoji: '🏋️',
        }),
      });
    });

    it('rechaza un nombre que ya existe', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      await expect(
        service.create(userId, { name: 'easetrain' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza nombre vacio', async () => {
      await expect(
        service.create(userId, { name: '  ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('404 si el proyecto no es del usuario', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(
        service.update(userId, 'p1', { status: 'paused' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('renombrar a un nombre de otro proyecto da conflicto', async () => {
      prisma.project.findFirst
        .mockResolvedValueOnce(project) // el propio
        .mockResolvedValueOnce({ ...project, id: 'p2', name: 'Stampia' });
      await expect(
        service.update(userId, 'p1', { name: 'Stampia' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('cambia estado y nombre', async () => {
      prisma.project.findFirst
        .mockResolvedValueOnce(project)
        .mockResolvedValueOnce(null);
      prisma.project.update.mockResolvedValue({
        ...project,
        name: 'Trainease',
      });

      await service.update(userId, 'p1', {
        name: 'Trainease',
        status: 'paused',
      });

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: 'Trainease', status: 'paused' },
      });
    });
  });

  describe('remove', () => {
    it('desvincula las tareas (no las borra) y borra el proyecto', async () => {
      prisma.project.findFirst.mockResolvedValue(project);

      await service.remove(userId, 'p1');

      expect(prisma.task.updateMany).toHaveBeenCalledWith({
        where: { userId, projectId: 'p1' },
        data: { projectId: null, milestoneId: null },
      });
      expect(prisma.project.delete).toHaveBeenCalledWith({
        where: { id: 'p1' },
      });
    });
  });

  describe('findOrCreateByName', () => {
    it('reusa el existente', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      expect(await service.findOrCreateByName(userId, 'easetrain')).toBe(
        project,
      );
      expect(prisma.project.create).not.toHaveBeenCalled();
    });

    it('crea si no existe', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      prisma.project.create.mockResolvedValue({ ...project, name: 'Piano' });
      const p = await service.findOrCreateByName(userId, ' Piano ');
      expect(p.name).toBe('Piano');
      expect(prisma.project.create).toHaveBeenCalledWith({
        data: { userId, name: 'Piano' },
      });
    });
  });

  describe('hitos', () => {
    it('crear hito en un proyecto ajeno da 404', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(
        service.createMilestone(userId, 'p1', { name: 'v2' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('crea el hito en el proyecto', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.milestone.create.mockResolvedValue({ id: 'm1' });

      await service.createMilestone(userId, 'p1', {
        name: ' Release v2 ',
        dueDate: '2026-11-01',
      });

      expect(prisma.milestone.create).toHaveBeenCalledWith({
        data: {
          userId,
          projectId: 'p1',
          name: 'Release v2',
          dueDate: '2026-11-01',
        },
      });
    });

    it('borrar hito desvincula sus tareas', async () => {
      prisma.milestone.findFirst.mockResolvedValue({ id: 'm1', userId });

      await service.removeMilestone(userId, 'm1');

      expect(prisma.task.updateMany).toHaveBeenCalledWith({
        where: { userId, milestoneId: 'm1' },
        data: { milestoneId: null },
      });
      expect(prisma.milestone.delete).toHaveBeenCalledWith({
        where: { id: 'm1' },
      });
    });

    it('editar hito ajeno da 404', async () => {
      prisma.milestone.findFirst.mockResolvedValue(null);
      await expect(
        service.updateMilestone(userId, 'm1', { done: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('migrateLegacy', () => {
    it('vincula tareas viejas: string guardado, inferido del titulo o ninguno', async () => {
      prisma.task.findMany.mockResolvedValue([
        { id: 't1', userId, title: 'EaseTrain — bug', project: null },
        { id: 't2', userId, title: 'Algo', project: 'Stampia' },
        { id: 't3', userId, title: 'Sin prefijo', project: null },
      ]);
      prisma.project.findFirst.mockResolvedValue(null);
      prisma.project.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: `id-${data.name}`, ...data }),
      );
      prisma.userPreferences.findUnique.mockResolvedValue(null);

      const n = await service.migrateLegacy(userId);

      expect(n).toBe(3);
      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { projectId: 'id-EaseTrain', project: '' },
      });
      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 't2' },
        data: { projectId: 'id-Stampia', project: '' },
      });
      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 't3' },
        data: { project: '' },
      });
    });

    it('pasa los pausados de las preferencias al estado del proyecto', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      prisma.userPreferences.findUnique.mockResolvedValue({
        pausedTaskProjects: ['EaseTrain'],
      });
      prisma.project.findFirst.mockResolvedValue(project);

      await service.migrateLegacy(userId);

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { status: 'paused' },
      });
    });
  });

  describe('compat con la app vieja (pausa por nombre)', () => {
    it('pausedNames devuelve los nombres de los pausados', async () => {
      prisma.project.findMany.mockResolvedValue([{ name: 'EaseTrain' }]);
      expect(await service.pausedNames(userId)).toEqual(['EaseTrain']);
    });

    it('setPausedByName pausa/reanuda y devuelve la lista', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.project.findMany.mockResolvedValue([{ name: 'EaseTrain' }]);

      const r = await service.setPausedByName(userId, 'easetrain', true);

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { status: 'paused' },
      });
      expect(r).toEqual(['EaseTrain']);
    });
  });
});
