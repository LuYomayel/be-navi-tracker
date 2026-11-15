import { AI_MODEL, aiJsonParams, aiParams } from './ai-model';

describe('aiParams', () => {
  it('usa el modelo unico de la app', () => {
    expect(AI_MODEL).toBe('gpt-6-luna');
    expect(aiParams(500).model).toBe(AI_MODEL);
  });

  it('no manda los parametros que el modelo rechaza (max_tokens, temperature)', () => {
    const p = aiParams(500) as Record<string, unknown>;
    expect(p.max_tokens).toBeUndefined();
    expect(p.temperature).toBeUndefined();
  });

  it('suma margen para el razonamiento: la respuesta no se corta por pensar', () => {
    expect(aiParams(500).max_completion_tokens).toBe(2500);
    expect(aiParams(500, 'low').reasoning_effort).toBe('low');
    expect(aiParams(4000, 'medium').max_completion_tokens).toBe(10000);
  });

  it('sin razonamiento el limite es exactamente la respuesta', () => {
    const p = aiParams(20, 'none');
    expect(p.max_completion_tokens).toBe(20);
    expect(p.reasoning_effort).toBe('none');
  });
});

describe('aiJsonParams', () => {
  it('fuerza salida JSON y conserva modelo, limite y razonamiento', () => {
    const p = aiJsonParams(4000, 'medium');
    expect(p.response_format).toEqual({ type: 'json_object' });
    expect(p.model).toBe(AI_MODEL);
    expect(p.max_completion_tokens).toBe(10000);
    expect(p.reasoning_effort).toBe('medium');
  });
});
