import { computePrintCost, computeSalePrice, computeProfit } from './pricing';

describe('pricing', () => {
  describe('computePrintCost', () => {
    it('calcula el costo con gramos, horas, desperdicio y luz', () => {
      // (127g * $20/g) * 1.15 desperdicio + 4.5h * $12/h = 2921 + 54 = 2975 -> redondeado a 3000
      const costo = computePrintCost({
        grams: 127,
        hours: 4.5,
        costPerGram: 20,
        wastePct: 0.15,
        powerPerHour: 12,
      });
      expect(costo).toBe(3000);
    });

    it('redondea al centenar mas cercano (verificado contra los 12 productos de la planilla)', () => {
      // Casos reales de la migracion: [grams, hours, costoEsperado]
      const casos: [number, number, number][] = [
        [127, 4.5, 3000],
        [133, 3.7, 3100],
        [393, 9.4, 9200],
        [146, 4.6, 3400],
        [245, 6.5, 5700],
        [787, 35.2, 18500],
        [175, 8.6, 4100],
        [494, 14.3, 11500],
        [96, 3.6, 2300],
        [113, 6.2, 2700],
        [281, 8.3, 6600],
        [451, 8.6, 10500],
      ];
      for (const [grams, hours, esperado] of casos) {
        const costo = computePrintCost({
          grams,
          hours,
          costPerGram: 20,
          wastePct: 0.15,
          powerPerHour: 12,
        });
        expect(costo).toBe(esperado);
      }
    });

    it('sin desperdicio ni luz, el costo es solo gramos x precio', () => {
      const costo = computePrintCost({
        grams: 100,
        hours: 0,
        costPerGram: 10,
        wastePct: 0,
        powerPerHour: 0,
      });
      expect(costo).toBe(1000);
    });
  });

  describe('computeSalePrice', () => {
    it('aplica el markup default y redondea al centenar', () => {
      // costo 3000 * 1.30 = 3900
      expect(computeSalePrice(3000, 1.3)).toBe(3900);
    });

    it('aplica un markup override distinto (familia fuxx x1.5)', () => {
      // costo 11500 * 1.5 = 17250 -> redondea a 17300 (mitad hacia arriba)
      expect(computeSalePrice(11500, 1.5)).toBe(17300);
    });

    it('verificado contra los 12 productos de la planilla (costo -> precio a Marcelito)', () => {
      const casos: [number, number, number][] = [
        [3000, 1.3, 3900],
        [3100, 1.3, 4000],
        [9200, 1.3, 12000],
        [3400, 1.3, 4400],
        [5700, 1.3, 7400],
        [18500, 1.3, 24100],
        [4100, 1.3, 5300],
        [11500, 1.5, 17300],
        [2300, 1.3, 3000],
        [2700, 1.3, 3500],
        [6600, 1.3, 8600],
        [10500, 1.5, 15800],
      ];
      for (const [costo, markup, esperado] of casos) {
        expect(computeSalePrice(costo, markup)).toBe(esperado);
      }
    });
  });

  describe('computeProfit', () => {
    it('ganancia = precio - costo', () => {
      expect(computeProfit(3900, 3000)).toBe(900);
    });

    it('puede dar negativo (ej: muestra regalada, precio 0)', () => {
      expect(computeProfit(0, 3000)).toBe(-3000);
    });
  });
});
