/** Avance de un proyecto o hito a partir de sus tareas. Funcion pura. */
export interface ProjectStats {
  total: number;
  done: number;
  pending: number;
  overdue: number;
  /** Fecha mas cercana (hoy o despues) de una tarea pendiente. */
  nextDue: string | null;
  /** 0-100 */
  progress: number;
}

export function computeStats(
  tasks: { completed: boolean; dueDate?: string | null }[],
  today: string,
): ProjectStats {
  let done = 0;
  let overdue = 0;
  let nextDue: string | null = null;

  for (const t of tasks) {
    if (t.completed) {
      done++;
      continue;
    }
    if (!t.dueDate) continue;
    if (t.dueDate < today) overdue++;
    else if (!nextDue || t.dueDate < nextDue) nextDue = t.dueDate;
  }

  const total = tasks.length;
  return {
    total,
    done,
    pending: total - done,
    overdue,
    nextDue,
    progress: total ? Math.round((done / total) * 100) : 0,
  };
}
