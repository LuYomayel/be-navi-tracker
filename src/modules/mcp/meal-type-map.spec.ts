import { MEAL_TYPE_MAP } from './mcp-server.factory';

/**
 * Regresion guard: la merienda NO debe mezclarse con el snack.
 * Antes ambos mapeaban a 'snack', lo que ademas hacia que al loguear una
 * merienda por MCP se deduplicara contra el snack del mismo dia.
 */
describe('MEAL_TYPE_MAP', () => {
  it('mapea cada tipo en espanol a su mealType del modelo', () => {
    expect(MEAL_TYPE_MAP.Desayuno).toBe('breakfast');
    expect(MEAL_TYPE_MAP.Almuerzo).toBe('lunch');
    expect(MEAL_TYPE_MAP.Cena).toBe('dinner');
    expect(MEAL_TYPE_MAP.Snack).toBe('snack');
  });

  it('Merienda es su propio mealType, distinto de Snack', () => {
    expect(MEAL_TYPE_MAP.Merienda).toBe('merienda');
    expect(MEAL_TYPE_MAP.Merienda).not.toBe(MEAL_TYPE_MAP.Snack);
  });
});
