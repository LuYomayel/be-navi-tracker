/**
 * Modelo unico de OpenAI para toda la app. Precio en `AICostService`.
 *
 * gpt-6-luna razona antes de responder, y eso cambia el contrato respecto de
 * gpt-4o (verificado contra la API, 2026-11):
 *  - `max_tokens` no existe: es `max_completion_tokens`, y INCLUYE los tokens
 *    de razonamiento. Con un limite justo la respuesta sale vacia
 *    (finish_reason "length"), por eso se suma margen.
 *  - `temperature` solo acepta el default: no se manda.
 */
export const AI_MODEL = 'gpt-6-luna';

/**
 * none   = sin razonar (clasificar, si/no).
 * low    = default: textos y lecturas simples.
 * medium = extraer datos de documentos (PDF de antropometria, resumenes).
 */
export type AiEffort = 'none' | 'low' | 'medium';

const REASONING_HEADROOM: Record<AiEffort, number> = {
  none: 0,
  low: 2000,
  medium: 6000,
};

/** Parametros para `openai.chat.completions.create({ ...aiParams(n), messages })`. */
export function aiParams(maxOutputTokens: number, effort: AiEffort = 'low') {
  return {
    model: AI_MODEL,
    max_completion_tokens: maxOutputTokens + REASONING_HEADROOM[effort],
    // Los tipos del SDK instalado todavia no conocen 'none'; la API si.
    reasoning_effort: effort as 'low' | 'medium',
  };
}

/**
 * Igual que aiParams pero obliga al modelo a devolver un objeto JSON valido
 * (sin markdown ni texto alrededor). Requisito de la API: el prompt tiene que
 * mencionar "JSON".
 */
export function aiJsonParams(maxOutputTokens: number, effort: AiEffort = 'low') {
  return {
    ...aiParams(maxOutputTokens, effort),
    response_format: { type: 'json_object' as const },
  };
}
