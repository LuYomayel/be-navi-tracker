/**
 * Helpers puros para la tool MCP `editar_tarea`: matching por título y mapeo
 * de argumentos MCP (español) → UpdateTaskDto. Separados del factory para
 * poder testearlos sin levantar el server MCP.
 */

interface TaskLike {
  id: string;
  title?: string | null;
  completed?: boolean;
}

export interface EditarTareaArgs {
  nuevo_titulo?: string;
  descripcion?: string;
  fecha?: string;
  hora?: string;
  prioridad?: 'low' | 'medium' | 'high' | 'urgent';
  categoria?: string;
  quitar_fecha?: boolean;
  proyecto?: string;
  quitar_proyecto?: boolean;
}

export function matchTaskByTitle<T extends TaskLike>(
  tasks: T[],
  query: string,
): T | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    tasks.find((t) => t.title?.toLowerCase() === q) ||
    tasks.find((t) => t.title?.toLowerCase().includes(q)) ||
    null
  );
}

export function buildTaskUpdateFromMcpArgs(
  args: EditarTareaArgs,
): Record<string, unknown> | null {
  const update: Record<string, unknown> = {};
  if (args.nuevo_titulo) update.title = args.nuevo_titulo;
  if (args.descripcion) update.description = args.descripcion;
  if (args.quitar_fecha) {
    update.dueDate = null;
    update.dueTime = null;
  } else {
    if (args.fecha) update.dueDate = args.fecha;
    if (args.hora) update.dueTime = args.hora;
  }
  if (args.prioridad) update.priority = args.prioridad;
  if (args.categoria) update.category = args.categoria;
  if (args.quitar_proyecto) update.project = '';
  else if (args.proyecto) update.project = args.proyecto;
  return Object.keys(update).length ? update : null;
}

interface StatsLike {
  pending?: number;
  total: number;
  done: number;
  overdue: number;
  nextDue: string | null;
  progress: number;
}

const STATUS_TAG: Record<string, string> = {
  paused: ' (pausado)',
  archived: ' (archivado)',
};

/** Una linea por proyecto (+ una por hito) para las tools de proyectos. */
export function formatProjectLine(p: {
  name: string;
  emoji?: string | null;
  status: string;
  stats: StatsLike;
  milestones: {
    name: string;
    done: boolean;
    dueDate?: string | null;
    stats: StatsLike;
  }[];
}): string {
  const s = p.stats;
  let line = `${p.emoji ? p.emoji + ' ' : ''}${p.name}${STATUS_TAG[p.status] ?? ''} — ${s.done}/${s.total} hechas (${s.progress}%)`;
  if (s.overdue) line += `, ${s.overdue} vencidas`;
  if (s.nextDue) line += `, próxima ${s.nextDue}`;
  for (const m of p.milestones) {
    line += `\n   · ${m.done ? '✓ ' : ''}${m.name}: ${m.stats.done}/${m.stats.total}`;
    if (m.dueDate && !m.done) line += ` (vence ${m.dueDate})`;
  }
  return line;
}
