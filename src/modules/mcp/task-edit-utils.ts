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
  return Object.keys(update).length ? update : null;
}
