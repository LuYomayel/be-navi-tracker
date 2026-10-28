import { BadRequestException } from '@nestjs/common';

/**
 * Paleta fija de colores de filamento: un nombre canonico por color, el
 * mismo en los rollos y en el desglose de los productos. Si no coinciden
 * el chequeo de stock no matchea (pasaba con "beige mate" en el stock y
 * "beige" en el Katamino).
 */
export const FILAMENT_COLORS = [
  'negro',
  'blanco',
  'gris',
  'rojo',
  'naranja',
  'amarillo',
  'amarillo girasol',
  'verde',
  'cian',
  'azul',
  'beige',
  'marrón',
  'rosa',
  'verde militar',
] as const;

export type FilamentColor = (typeof FILAMENT_COLORS)[number];

// Nombres viejos y los que usa Bambu (ingles) -> canonico. Las claves van
// sin tilde porque se comparan contra el input ya normalizado.
const ALIASES: Record<string, FilamentColor> = {
  black: 'negro',
  white: 'blanco',
  grey: 'gris',
  gray: 'gris',
  red: 'rojo',
  orange: 'naranja',
  yellow: 'amarillo',
  sunflower: 'amarillo girasol',
  'sunflower yellow': 'amarillo girasol',
  girasol: 'amarillo girasol',
  green: 'verde',
  cyan: 'cian',
  blue: 'azul',
  'beige mate': 'beige',
  brown: 'marrón',
  pink: 'rosa',
};

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const BY_FOLDED = new Map<string, FilamentColor>([
  ...FILAMENT_COLORS.map((c) => [fold(c), c] as [string, FilamentColor]),
  ...Object.entries(ALIASES),
]);

/** Nombre canonico de un color, o null si no esta en la paleta. */
export function canonicalColor(input?: string | null): FilamentColor | null {
  if (!input) return null;
  return BY_FOLDED.get(fold(input)) ?? null;
}

/** Igual que canonicalColor pero tira 400 si el color no esta en la paleta. */
export function assertPaletteColor(input?: string | null): FilamentColor {
  const color = canonicalColor(input);
  if (!color) {
    throw new BadRequestException(
      `El color "${input ?? ''}" no esta en la paleta: ${FILAMENT_COLORS.join(', ')}`,
    );
  }
  return color;
}
