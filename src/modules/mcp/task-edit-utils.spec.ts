import {
  matchTaskByTitle,
  buildTaskUpdateFromMcpArgs,
  formatProjectLine,
} from './task-edit-utils';

describe('matchTaskByTitle', () => {
  const tasks = [
    { id: 't1', title: 'Comprar filamento', completed: false },
    { id: 't2', title: 'Llamar al nutricionista', completed: false },
    { id: 't3', title: 'Comprar filamento PLA negro', completed: false },
    { id: 't4', title: 'Pagar internet', completed: true },
  ];

  it('prefers an exact match (case-insensitive) over partial ones', () => {
    const t = matchTaskByTitle(tasks as any[], 'comprar filamento');
    expect(t?.id).toBe('t1');
  });

  it('falls back to partial match', () => {
    const t = matchTaskByTitle(tasks as any[], 'nutricionista');
    expect(t?.id).toBe('t2');
  });

  it('returns null when nothing matches', () => {
    expect(matchTaskByTitle(tasks as any[], 'inexistente')).toBeNull();
  });

  it('matches completed tasks too (editar aplica a cualquier tarea)', () => {
    const t = matchTaskByTitle(tasks as any[], 'pagar internet');
    expect(t?.id).toBe('t4');
  });
});

describe('buildTaskUpdateFromMcpArgs', () => {
  it('maps only the provided fields', () => {
    const update = buildTaskUpdateFromMcpArgs({
      fecha: '2026-08-10',
      prioridad: 'high',
    });
    expect(update).toEqual({ dueDate: '2026-08-10', priority: 'high' });
  });

  it('maps a full edit', () => {
    const update = buildTaskUpdateFromMcpArgs({
      nuevo_titulo: 'Nuevo nombre',
      descripcion: 'Detalle',
      fecha: '2026-08-11',
      hora: '09:30',
      prioridad: 'urgent',
      categoria: 'personal',
    });
    expect(update).toEqual({
      title: 'Nuevo nombre',
      description: 'Detalle',
      dueDate: '2026-08-11',
      dueTime: '09:30',
      priority: 'urgent',
      category: 'personal',
    });
  });

  it('clears the due date (and time) with quitar_fecha', () => {
    const update = buildTaskUpdateFromMcpArgs({ quitar_fecha: true });
    expect(update).toEqual({ dueDate: null, dueTime: null });
  });

  it('returns null when there is nothing to update', () => {
    expect(buildTaskUpdateFromMcpArgs({})).toBeNull();
  });
});

describe('buildTaskUpdateFromMcpArgs — proyecto', () => {
  it('mapea proyecto', () => {
    expect(buildTaskUpdateFromMcpArgs({ proyecto: 'Stampia' })).toEqual({
      project: 'Stampia',
    });
  });

  it('quitar_proyecto lo deja vacio (sin proyecto a proposito)', () => {
    expect(buildTaskUpdateFromMcpArgs({ quitar_proyecto: true })).toEqual({
      project: '',
    });
  });
});

describe('formatProjectLine', () => {
  const stats = {
    total: 10,
    done: 4,
    pending: 6,
    overdue: 2,
    nextDue: '2026-10-12',
    progress: 40,
  };

  it('resume avance, vencidas, proxima fecha e hitos', () => {
    const line = formatProjectLine({
      name: 'EaseTrain',
      emoji: '🏋️',
      status: 'paused',
      stats,
      milestones: [
        {
          name: 'v2',
          done: false,
          dueDate: '2026-11-01',
          stats: { ...stats, total: 3, done: 1 },
        },
        {
          name: 'Beta',
          done: true,
          dueDate: null,
          stats: { ...stats, total: 2, done: 2 },
        },
      ],
    });

    expect(line).toBe(
      '🏋️ EaseTrain (pausado) — 4/10 hechas (40%), 2 vencidas, próxima 2026-10-12\n' +
        '   · v2: 1/3 (vence 2026-11-01)\n' +
        '   · ✓ Beta: 2/2',
    );
  });

  it('proyecto activo sin hitos ni fechas', () => {
    expect(
      formatProjectLine({
        name: 'Piano',
        emoji: null,
        status: 'active',
        stats: {
          total: 1,
          done: 0,
          pending: 1,
          overdue: 0,
          nextDue: null,
          progress: 0,
        },
        milestones: [],
      }),
    ).toBe('Piano — 0/1 hechas (0%)');
  });
});
