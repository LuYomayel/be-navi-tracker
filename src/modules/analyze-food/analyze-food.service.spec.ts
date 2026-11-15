import {
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AnalyzeFoodService, MealType } from './analyze-food.service';
import { FOOD_MODEL } from './food-analysis';

const modelJson = (foods: any[], assumptions: string[] = []) => ({
  choices: [{ message: { content: JSON.stringify({ foods, assumptions }) } }],
  usage: { prompt_tokens: 1000, completion_tokens: 400, total_tokens: 1400 },
});

const rice = {
  name: 'Arroz blanco cocido',
  quantity: '1 taza',
  grams: 150,
  category: 'carbs',
  certainty: 'alta',
  per100g: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sugar: 0.1, sodium: 1 },
};

describe('AnalyzeFoodService', () => {
  let service: AnalyzeFoodService;
  let create: jest.Mock;
  let aiCost: { logFromCompletion: jest.Mock; calculateCost: jest.Mock };

  beforeEach(() => {
    aiCost = {
      logFromCompletion: jest.fn().mockResolvedValue(undefined),
      calculateCost: jest.fn().mockReturnValue(0.0003),
    };
    service = new AnalyzeFoodService(aiCost as any);
    create = jest.fn().mockResolvedValue(modelJson([rice], ['Asumí arroz sin aceite']));
    (service as any).openai = { chat: { completions: { create } } };
  });

  describe('analyzeManualFood', () => {
    it('pide salida estructurada al modelo de comidas y devuelve el analisis calculado', async () => {
      const r = await service.analyzeManualFood('arroz', 1, MealType.LUNCH, undefined, 'u1');

      const req = create.mock.calls[0][0];
      expect(req.model).toBe(FOOD_MODEL);
      expect(req.response_format.type).toBe('json_schema');
      expect(req.response_format.json_schema.strict).toBe(true);
      // Parametros que el modelo no acepta
      expect(req.max_tokens).toBeUndefined();
      expect(req.temperature).toBeUndefined();

      expect(r.totalCalories).toBe(195);
      expect(r.foods[0].grams).toBe(150);
      expect(r.assumptions).toEqual(['Asumí arroz sin aceite']);
      expect(r.aiCostUsd).toBe(0.0003);
    });

    it('manda la descripcion y el contexto del usuario', async () => {
      await service.analyzeManualFood('milanesa con puré', 1, MealType.DINNER, 'al horno, sin aceite', 'u1');

      const user = create.mock.calls[0][0].messages[1].content;
      expect(user).toContain('milanesa con puré');
      expect(user).toContain('al horno, sin aceite');
      expect(user).toContain('cena');
    });

    it('aplica las porciones en codigo, no se las delega al modelo', async () => {
      const r = await service.analyzeManualFood('arroz', 2, MealType.LUNCH);
      expect(r.foods[0].grams).toBe(300);
      expect(r.totalCalories).toBe(390);
    });

    it('registra el costo con el modelo real', async () => {
      await service.analyzeManualFood('arroz', 1, MealType.LUNCH, undefined, 'u1');
      expect(aiCost.logFromCompletion).toHaveBeenCalledWith(
        'u1',
        'analyze-food-manual',
        expect.anything(),
        FOOD_MODEL,
      );
      expect(aiCost.calculateCost).toHaveBeenCalledWith(1000, 400, FOOD_MODEL);
    });

    it('si OpenAI falla, FALLA: nunca devuelve un plato inventado', async () => {
      create.mockRejectedValue(new Error('rate limit'));
      await expect(
        service.analyzeManualFood('arroz', 1, MealType.LUNCH),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('sin API key falla con 503 en vez de devolver datos de ejemplo', async () => {
      (service as any).openai = null;
      await expect(
        service.analyzeManualFood('arroz', 1, MealType.LUNCH),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('si el modelo no identifica comida, 422 con el motivo', async () => {
      create.mockResolvedValue(modelJson([], ['La foto muestra un teclado']));
      await expect(
        service.analyzeManualFood('asdf', 1, MealType.LUNCH),
      ).rejects.toMatchObject({
        constructor: UnprocessableEntityException,
        message: expect.stringContaining('La foto muestra un teclado'),
      });
    });

    it('si la respuesta viene cortada o vacia, falla', async () => {
      create.mockResolvedValue({ choices: [{ message: { content: '' } }] });
      await expect(
        service.analyzeManualFood('arroz', 1, MealType.LUNCH),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('analyzeImageFood', () => {
    it('manda la imagen y el contexto, y registra el costo como imagen', async () => {
      const r = await service.analyzeImageFood('data:image/jpeg;base64,AAAA', 'lunch', 'son 2 huevos', 'u1');

      const content = create.mock.calls[0][0].messages[1].content;
      expect(content.find((c: any) => c.type === 'image_url').image_url.url).toBe(
        'data:image/jpeg;base64,AAAA',
      );
      expect(content.find((c: any) => c.type === 'text').text).toContain('son 2 huevos');
      expect(aiCost.logFromCompletion).toHaveBeenCalledWith(
        'u1',
        'analyze-food-image',
        expect.anything(),
        FOOD_MODEL,
      );
      expect(r.totalCalories).toBe(195);
    });

    it('si OpenAI falla, falla (sin plato inventado)', async () => {
      create.mockRejectedValue(new Error('boom'));
      await expect(
        service.analyzeImageFood('data:image/jpeg;base64,AAAA', 'lunch'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
