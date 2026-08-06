import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

/**
 * Smoke test de wiring: compila el grafo COMPLETO de módulos y resuelve
 * todas las dependencias. Caza los "Nest can't resolve dependencies" que
 * los unit tests (con providers mockeados) no ven — como el crash-loop de
 * prod del 2026-08-06 (MercadoPagoService sin ExpensesModule importado).
 * No llama init(): no conecta DB ni arranca crons.
 */
describe('AppModule wiring', () => {
  it('should resolve every provider in the full module graph', async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(module).toBeDefined();
    await module.close();
  }, 30000);
});
