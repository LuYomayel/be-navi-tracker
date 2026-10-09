/**
 * Proyecto de una tarea (EaseTrain, Stampia, Pulpou...). Es un eje distinto
 * de la categoria: la categoria dice QUE tipo de cosa es (trabajo, salud),
 * el proyecto dice DE QUIEN es, y es lo que se pausa cuando un proyecto
 * queda en espera.
 *
 * Las tareas viejas no tienen el campo, pero casi todas llevan el proyecto
 * adelante en el titulo ("EaseTrain — ...", "Stampia - ...", "EMA: ...").
 * Por eso se infiere del prefijo cuando no hay uno guardado.
 */

/** Prefijo corto + separador (— – : o " - " con espacios). */
const PREFIX_RE = /^\s*([^—–:]+?)\s*(?:—|–|:|\s-)\s+\S/;

/** Un prefijo de mas de 2 palabras es una frase, no un nombre de proyecto. */
const MAX_WORDS = 2;
const MAX_CHARS = 20;

export const NZ_PROJECT = 'NZ';

export function inferProject(title: string | null | undefined): string | null {
  const t = (title ?? '').trim();
  if (!t) return null;
  if (t.startsWith('🇳🇿')) return NZ_PROJECT;

  const m = PREFIX_RE.exec(t);
  if (!m) return null;
  const name = m[1].trim();
  if (name.length > MAX_CHARS || name.split(/\s+/).length > MAX_WORDS) {
    return null;
  }
  return name;
}

/**
 * Valor a guardar. undefined = no tocar (update parcial). "" se guarda tal
 * cual y significa "sin proyecto, a proposito": asi sacarle el proyecto a
 * "EaseTrain — algo" no hace que se vuelva a inferir del titulo.
 */
export function normalizeProject(
  p: string | null | undefined,
): string | undefined {
  if (p === undefined) return undefined;
  return (p ?? '').trim();
}

/** null en la base = tarea vieja, nunca se eligio proyecto: se infiere. */
export function resolveProject(task: {
  project?: string | null;
  title?: string | null;
}): string | null {
  if (task.project === null || task.project === undefined) {
    return inferProject(task.title);
  }
  return task.project.trim() || null;
}

/** Comparacion de proyectos sin importar mayusculas ("PulpoU" = "Pulpou"). */
export function projectKey(p: string): string {
  return p.trim().toLowerCase();
}
