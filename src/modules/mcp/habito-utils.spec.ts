import {
  parseDiasHabito,
  formatDias,
  resolveColorHabito,
  TODOS_LOS_DIAS,
} from './habito-utils';

describe('habito-utils', () => {
  describe('parseDiasHabito', () => {
    it('devuelve todos los dias cuando no hay input', () => {
      expect(parseDiasHabito()).toEqual(TODOS_LOS_DIAS);
      expect(parseDiasHabito(undefined)).toEqual(TODOS_LOS_DIAS);
      expect(parseDiasHabito('')).toEqual(TODOS_LOS_DIAS);
    });

    it('reconoce "todos" / "diario" / "todos los dias"', () => {
      expect(parseDiasHabito('todos')).toEqual(TODOS_LOS_DIAS);
      expect(parseDiasHabito('diario')).toEqual(TODOS_LOS_DIAS);
      expect(parseDiasHabito('todos los dias')).toEqual(TODOS_LOS_DIAS);
    });

    it('parsea letras estilo argentino L M X J V S D', () => {
      // [L, M, X, J, V, S, D]
      expect(parseDiasHabito('L,M,V')).toEqual([
        true, true, false, false, true, false, false,
      ]);
      expect(parseDiasHabito('X')).toEqual([
        false, false, true, false, false, false, false,
      ]);
    });

    it('parsea abreviaturas y nombres completos (con o sin acento)', () => {
      expect(parseDiasHabito('lun, mie, vie')).toEqual([
        true, false, true, false, true, false, false,
      ]);
      expect(parseDiasHabito('miércoles')).toEqual([
        false, false, true, false, false, false, false,
      ]);
      expect(parseDiasHabito('sabado y domingo')).toEqual([
        false, false, false, false, false, true, true,
      ]);
    });

    it('acepta un array de tokens', () => {
      expect(parseDiasHabito(['lunes', 'jueves'])).toEqual([
        true, false, false, true, false, false, false,
      ]);
    });

    it('reconoce "finde" y "habiles"/"semana"', () => {
      expect(parseDiasHabito('finde')).toEqual([
        false, false, false, false, false, true, true,
      ]);
      expect(parseDiasHabito('habiles')).toEqual([
        true, true, true, true, true, false, false,
      ]);
    });

    it('ignora tokens desconocidos sin romper', () => {
      expect(parseDiasHabito('lunes, banana')).toEqual([
        true, false, false, false, false, false, false,
      ]);
    });

    it('si no reconoce ningun dia valido, cae a todos los dias', () => {
      expect(parseDiasHabito('banana, pizza')).toEqual(TODOS_LOS_DIAS);
    });
  });

  describe('formatDias', () => {
    it('formatea todos los dias como "todos los dias"', () => {
      expect(formatDias(TODOS_LOS_DIAS)).toBe('todos los dias');
    });

    it('formatea dias habiles', () => {
      expect(
        formatDias([true, true, true, true, true, false, false]),
      ).toBe('L, M, X, J, V');
    });

    it('formatea finde', () => {
      expect(
        formatDias([false, false, false, false, false, true, true]),
      ).toBe('S, D');
    });
  });

  describe('resolveColorHabito', () => {
    it('usa el color provisto si es un hex valido', () => {
      expect(resolveColorHabito('#ff0000')).toBe('#ff0000');
      expect(resolveColorHabito('#ABC')).toBe('#ABC');
    });

    it('devuelve un color por defecto valido si no se provee', () => {
      expect(resolveColorHabito()).toMatch(/^#[0-9a-fA-F]{3,6}$/);
    });

    it('ignora un color invalido y cae al default', () => {
      expect(resolveColorHabito('rojo')).toMatch(/^#[0-9a-fA-F]{3,6}$/);
    });
  });
});
