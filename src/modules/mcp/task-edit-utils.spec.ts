import {
  matchTaskByTitle,
  buildTaskUpdateFromMcpArgs,
  formatProjectLine,
  matchMilestone,
  formatProjectDetail,
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

describe('buildTaskUpdateFromMcpArgs — estado e hito', () => {
  it('estado en_curso / pendiente', () => {
    expect(buildTaskUpdateFromMcpArgs({ estado: 'en_curso' })).toEqual({
      status: 'in_progress',
    });
    expect(buildTaskUpdateFromMcpArgs({ estado: 'pendiente' })).toEqual({
      status: 'pending',
    });
  });

  it('quitar_hito deja milestoneId null', () => {
    expect(buildTaskUpdateFromMcpArgs({ quitar_hito: true })).toEqual({
      milestoneId: null,
    });
  });
});

describe('matchMilestone', () => {
  const projects = [
    { id: 'p1', name: 'EaseTrain', milestones: [{ id: 'm1', name: 'Release v2' }, { id: 'm2', name: 'Beta' }] },
    { id: 'p2', name: 'Stampia', milestones: [{ id: 'm3', name: 'Release v2' }] },
  ];

  it('busca dentro del proyecto indicado', () => {
    expect(matchMilestone(projects, 'release', 'stampia')?.id).toBe('m3');
  });

  it('sin proyecto, si el nombre es unico lo encuentra', () => {
    expect(matchMilestone(projects, 'beta')?.id).toBe('m2');
  });

  it('sin proyecto y ambiguo devuelve null', () => {
    expect(matchMilestone(projects, 'release v2')).toBeNull();
  });

  it('exacto gana sobre parcial', () => {
    const ps = [{ id: 'p', name: 'X', milestones: [{ id: 'a', name: 'v2 final' }, { id: 'b', name: 'v2' }] }];
    expect(matchMilestone(ps, 'v2')?.id).toBe('b');
  });
});

describe('formatProjectDetail', () => {
  it('lista tareas pendientes agrupadas por hito y las hechas resumidas', () => {
    const out = formatProjectDetail(
      {
        name: 'EaseTrain',
        emoji: null,
        status: 'active',
        description: 'App de coaching',
        stats: { total: 4, done: 1, pending: 3, overdue: 0, nextDue: null, progress: 25 },
        milestones: [
          { id: 'm1', name: 'v2', done: false, dueDate: '2026-11-01', stats: { total: 2, done: 1, pending: 1, overdue: 0, nextDue: null, progress: 50 } },
        ],
      },
      [
        { title: 'Bug login', milestoneId: 'm1', completed: false, status: 'in_progress', priority: 'high', dueDate: '2026-10-10' },
        { title: 'Deploy', milestoneId: 'm1', completed: true, status: 'completed', priority: 'medium' },
        { title: 'Docs', milestoneId: null, completed: false, status: 'pending', priority: 'low' },
        { title: 'Logo', milestoneId: null, completed: false, status: 'pending', priority: 'medium' },
      ],
    );

    expect(out).toBe(
      [
        'EaseTrain — 1/4 hechas (25%)',
        'App de coaching',
        '',
        '🏁 v2 (vence 2026-11-01) — 1/2',
        '  ○ Bug login [en curso] (2026-10-10) [high]',
        '',
        'Sin hito:',
        '  ○ Docs [low]',
        '  ○ Logo [medium]',
        '',
        '✓ 1 hecha (incluir_completadas=true para verlas)',
      ].join('\n'),
    );
  });
});
