import {
  computePrintCost,
  computeSalePrice,
  computeProfit,
  pricingForProduct,
} from './pricing';

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

  describe('pricingForProduct (overrides manuales)', () => {
    const settings = {
      costPerGram: 20,
      wastePct: 0.15,
      powerPerHour: 12,
      defaultMarkup: 1.3,
    };

    it('sin overrides calcula todo con la formula y marca ambos como automaticos', () => {
      const r = pricingForProduct(
        { grams: 127, hours: 4.5, markupOverride: null }, settings,
      );
      expect(r).toEqual({
        cost: 3000,
        priceToMarcelito: 3900,
        profit: 900,
        costIsManual: false,
        priceIsManual: false,
      });
    });

    it('costOverride pisa el costo calculado y el precio se recalcula sobre el costo real', () => {
      // Katamino: la formula da 8800 (costPerGram global 20) pero el filamento
      // real (PLA Wood $32/g + color $21/g) sale 11700 -> a Marcelito 15200.
      const r = pricingForProduct(
        { grams: 374.85, hours: 15.9, markupOverride: null, costOverride: 11700 },
        settings,
      );
      expect(r.cost).toBe(11700);
      expect(r.priceToMarcelito).toBe(15200); // 11700 * 1.3 = 15210 -> centenar
      expect(r.profit).toBe(3500);
      expect(r.costIsManual).toBe(true);
      expect(r.priceIsManual).toBe(false);
    });

    it('priceOverride pisa el precio a Marcelito y la ganancia sale de ese precio', () => {
      const r = pricingForProduct(
        { grams: 127, hours: 4.5, markupOverride: null, priceOverride: 4500 },
        settings,
      );
      expect(r.cost).toBe(3000);
      expect(r.priceToMarcelito).toBe(4500);
      expect(r.profit).toBe(1500);
      expect(r.costIsManual).toBe(false);
      expect(r.priceIsManual).toBe(true);
    });

    it('con los dos overrides ignora la formula por completo', () => {
      const r = pricingForProduct(
        {
          grams: 374.85,
          hours: 15.9,
          markupOverride: 1.5,
          costOverride: 11700,
          priceOverride: 16000,
        },
        settings,
      );
      expect(r).toEqual({
        cost: 11700,
        priceToMarcelito: 16000,
        profit: 4300,
        costIsManual: true,
        priceIsManual: true,
      });
    });

    it('respeta el valor manual tal cual, sin redondear al centenar', () => {
      const r = pricingForProduct(
        { grams: 100, hours: 1, markupOverride: null, costOverride: 11712, priceOverride: 15250 },
        settings,
      );
      expect(r.cost).toBe(11712);
      expect(r.priceToMarcelito).toBe(15250);
      expect(r.profit).toBe(3538);
    });

    it('un override en 0 es un valor valido (muestra regalada), no un "sin dato"', () => {
      const r = pricingForProduct(
        { grams: 127, hours: 4.5, markupOverride: null, priceOverride: 0 },
        settings,
      );
      expect(r.priceToMarcelito).toBe(0);
      expect(r.profit).toBe(-3000);
      expect(r.priceIsManual).toBe(true);
    });

    it('el markupOverride sigue aplicando sobre el costo manual', () => {
      const r = pricingForProduct(
        { grams: 494, hours: 14.3, markupOverride: 1.5, costOverride: 12000 },
        settings,
      );
      expect(r.priceToMarcelito).toBe(18000);
    });
  });
});
