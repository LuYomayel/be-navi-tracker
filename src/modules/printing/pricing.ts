/**
 * Calculo de costos del negocio de impresion 3D. Funcion pura (sin DB) para
 * poder testearla aislada y reusarla en el catalogo publico, la cotizacion
 * de MCP y el snapshot que se guarda en cada venta.
 *
 * Formulas (verificadas contra los 12 productos reales de la planilla):
 *   costo = (gramos * costPerGram) * (1 + wastePct) + horas * powerPerHour
 *   precio = costo * (markupOverride ?? defaultMarkup)
 *   ganancia = precio - costo
 *
 * Redondeo: al centenar mas cercano, igual que en la planilla de Luciano.
 * Math.round() (no el "banker's rounding" de otros lenguajes) es clave: en
 * los casos .5 exactos (ej 172.5 -> 173) la planilla redondea siempre hacia
 * arriba, que es el comportamiento nativo de Math.round en JS.
 */

export interface PrintCostInput {
  grams: number;
  hours: number;
  costPerGram: number;
  wastePct: number;
  powerPerHour: number;
}

/** Redondea al centenar mas cercano (mismo criterio que la planilla). */
export function roundToHundred(n: number): number {
  return Math.round(n / 100) * 100;
}

/** Costo real de imprimir una pieza (filamento + desperdicio + luz). */
export function computePrintCost(input: PrintCostInput): number {
  const raw =
    input.grams * input.costPerGram * (1 + input.wastePct) +
    input.hours * input.powerPerHour;
  return roundToHundred(raw);
}

/** Precio de venta (a Marcelito) aplicando el markup sobre el costo. */
export function computeSalePrice(cost: number, markup: number): number {
  return roundToHundred(cost * markup);
}

/** Ganancia = precio de venta - costo. Puede ser negativa (ej: muestras). */
export function computeProfit(price: number, cost: number): number {
  return price - cost;
}

export interface PricingSettings {
  costPerGram: number;
  wastePct: number;
  powerPerHour: number;
  defaultMarkup: number;
}

/**
 * Costo/precio/ganancia de un producto con las settings de costeo vigentes.
 * Centralizado aca (puro) para que lo usen el service, el catalogo publico
 * y los pedidos sin duplicar la formula.
 */
export function pricingForProduct(
  product: { grams: number; hours: number; markupOverride: number | null },
  settings: PricingSettings,
) {
  const cost = computePrintCost({
    grams: product.grams,
    hours: product.hours,
    costPerGram: settings.costPerGram,
    wastePct: settings.wastePct,
    powerPerHour: settings.powerPerHour,
  });
  const markup = product.markupOverride ?? settings.defaultMarkup;
  const priceToMarcelito = computeSalePrice(cost, markup);
  const profit = computeProfit(priceToMarcelito, cost);
  return { cost, priceToMarcelito, profit };
}
