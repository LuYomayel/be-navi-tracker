import { FILAMENT_COLORS, canonicalColor, assertPaletteColor } from './colors';

describe('paleta de colores de filamento', () => {
  it('tiene un nombre canonico por color, sin repetidos', () => {
    expect(new Set(FILAMENT_COLORS).size).toBe(FILAMENT_COLORS.length);
    expect(FILAMENT_COLORS).toEqual(
      expect.arrayContaining([
        'negro',
        'amarillo girasol',
        'marrón',
        'verde militar',
      ]),
    );
  });

  it('acepta el canonico sin importar mayusculas ni espacios', () => {
    expect(canonicalColor('Negro')).toBe('negro');
    expect(canonicalColor('  Amarillo   Girasol ')).toBe('amarillo girasol');
  });

  it('tolera la falta de tilde', () => {
    expect(canonicalColor('marron')).toBe('marrón');
  });

  it('traduce los nombres que hoy no cierran (Katamino vs stock)', () => {
    expect(canonicalColor('beige mate')).toBe('beige');
    expect(canonicalColor('sunflower yellow')).toBe('amarillo girasol');
    expect(canonicalColor('cyan')).toBe('cian');
  });

  it('traduce los nombres en ingles de Bambu', () => {
    expect(canonicalColor('Black')).toBe('negro');
    expect(canonicalColor('Grey')).toBe('gris');
    expect(canonicalColor('Sunflower')).toBe('amarillo girasol');
  });

  it('un color fuera de la paleta da null', () => {
    expect(canonicalColor('fucsia')).toBeNull();
    expect(canonicalColor('')).toBeNull();
    expect(canonicalColor(undefined)).toBeNull();
  });

  it('assertPaletteColor devuelve el canonico o tira con la paleta en el mensaje', () => {
    expect(assertPaletteColor('Cian')).toBe('cian');
    expect(() => assertPaletteColor('fucsia')).toThrow(/negro, blanco/);
  });
});
