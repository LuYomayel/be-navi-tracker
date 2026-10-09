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
  estado?: 'pendiente' | 'en_curso';
  quitar_hito?: boolean;
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
  if (args.estado) update.status = args.estado === 'en_curso' ? 'in_progress' : 'pending';
  if (args.quitar_hito) update.milestoneId = null;
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

/**
 * Hito por nombre. Con proyecto: busca solo ahi. Sin proyecto: solo si el
 * nombre es inequivoco entre todos (dos "Release v2" en proyectos distintos
 * = null, para no mover una tarea al proyecto equivocado).
 */
export function matchMilestone<
  M extends { id: string; name: string },
  P extends { name: string; milestones: M[] },
>(projects: P[], hito: string, proyecto?: string): M | null {
  const q = hito.trim().toLowerCase();
  if (!q) return null;
  let scope = projects;
  if (proyecto) {
    const pq = proyecto.trim().toLowerCase();
    const p =
      projects.find((x) => x.name.toLowerCase() === pq) ||
      projects.find((x) => x.name.toLowerCase().includes(pq));
    if (!p) return null;
    scope = [p];
  }
  const all = scope.flatMap((p) => p.milestones);
  const exact = all.filter((m) => m.name.toLowerCase() === q);
  const hits = exact.length ? exact : all.filter((m) => m.name.toLowerCase().includes(q));
  return hits.length === 1 ? hits[0] : null;
}

interface TaskLine {
  title: string;
  milestoneId?: string | null;
  completed: boolean;
  status?: string;
  priority: string;
  dueDate?: string | null;
  dueTime?: string | null;
}

function taskLine(t: TaskLine): string {
  return `  ${t.completed ? '✓' : '○'} ${t.title}${t.status === 'in_progress' && !t.completed ? ' [en curso]' : ''}${
    t.dueDate ? ` (${t.dueDate}${t.dueTime ? ' ' + t.dueTime : ''})` : ''
  } [${t.priority}]`;
}

/** Proyecto completo para Claude: tareas agrupadas por hito ("subtareas"). */
export function formatProjectDetail(
  p: {
    name: string;
    emoji?: string | null;
    status: string;
    description?: string | null;
    stats: StatsLike;
    milestones: {
      id: string;
      name: string;
      done: boolean;
      dueDate?: string | null;
      stats: StatsLike;
    }[];
  },
  tasks: TaskLine[],
  includeDone = false,
): string {
  const lines = [formatProjectLine({ ...p, milestones: [] })];
  if (p.description) lines.push(p.description);
  const show = (t: TaskLine) => includeDone || !t.completed;

  for (const m of p.milestones) {
    const mine = tasks.filter((t) => t.milestoneId === m.id && show(t));
    lines.push(
      '',
      `🏁 ${m.done ? '✓ ' : ''}${m.name}${m.dueDate && !m.done ? ` (vence ${m.dueDate})` : ''} — ${m.stats.done}/${m.stats.total}`,
      ...mine.map(taskLine),
    );
  }
  const loose = tasks.filter((t) => !t.milestoneId && show(t));
  if (loose.length) {
    lines.push('', p.milestones.length ? 'Sin hito:' : 'Tareas:', ...loose.map(taskLine));
  }
  const done = tasks.filter((t) => t.completed).length;
  if (!includeDone && done) {
    lines.push('', `✓ ${done} hecha${done === 1 ? '' : 's'} (incluir_completadas=true para verlas)`);
  }
  return lines.join('\n');
}
