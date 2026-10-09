import { computeStats } from './project-stats';

describe('computeStats', () => {
  const today = '2026-10-09';

  it('cuenta total, hechas, pendientes, vencidas y proxima fecha', () => {
    const stats = computeStats(
      [
        { completed: true, dueDate: '2026-10-01' },
        { completed: false, dueDate: '2026-10-05' }, // vencida
        { completed: false, dueDate: '2026-10-20' },
        { completed: false, dueDate: '2026-10-12' }, // proxima
        { completed: false, dueDate: null },
      ],
      today,
    );

    expect(stats).toEqual({
      total: 5,
      done: 1,
      pending: 4,
      overdue: 1,
      nextDue: '2026-10-12',
      progress: 20,
    });
  });

  it('una tarea de hoy no esta vencida y es la proxima', () => {
    const stats = computeStats([{ completed: false, dueDate: today }], today);
    expect(stats.overdue).toBe(0);
    expect(stats.nextDue).toBe(today);
  });

  it('sin tareas da todo en cero', () => {
    expect(computeStats([], today)).toEqual({
      total: 0,
      done: 0,
      pending: 0,
      overdue: 0,
      nextDue: null,
      progress: 0,
    });
  });
});
