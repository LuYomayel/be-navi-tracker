import {
  cycleOf,
  cycleDueIn,
  nextDueCycle,
  DEFAULT_CYCLE,
} from './card-cycle';

describe('card-cycle', () => {
  // Visa 4112 y la adicional de Leandro: cierran el 29, vencen el 11
  const visa = { closingDay: 29, dueDay: 11 };

  describe('cycleOf', () => {
    it('should put a consumption on or before the closing day in that month cycle', () => {
      expect(cycleOf('2026-10-29', visa)).toEqual({
        start: '2026-09-30',
        closing: '2026-10-29',
        due: '2026-11-11',
      });
    });

    it('should put a consumption after the closing day in the next cycle', () => {
      expect(cycleOf('2026-10-30', visa)).toEqual({
        start: '2026-10-30',
        closing: '2026-11-29',
        due: '2026-12-11',
      });
    });

    it('should clamp the closing day to short months (febrero)', () => {
      expect(cycleOf('2027-02-15', visa)).toEqual({
        start: '2027-01-30',
        closing: '2027-02-28',
        due: '2027-03-11',
      });
      expect(cycleOf('2027-03-01', visa).start).toBe('2027-03-01');
    });

    it('should keep the due date in the same month when it comes after the closing day', () => {
      expect(cycleOf('2026-10-05', { closingDay: 10, dueDay: 25 })).toEqual({
        start: '2026-09-11',
        closing: '2026-10-10',
        due: '2026-10-25',
      });
    });

    it('should behave as the calendar month by default (vence el 10 del mes siguiente)', () => {
      expect(cycleOf('2026-11-30', DEFAULT_CYCLE)).toEqual({
        start: '2026-11-01',
        closing: '2026-11-30',
        due: '2026-12-10',
      });
    });
  });

  describe('cycleDueIn', () => {
    it('should return the cycle whose payment falls in the month', () => {
      expect(cycleDueIn('2026-12', visa)).toEqual({
        start: '2026-10-30',
        closing: '2026-11-29',
        due: '2026-12-11',
      });
      expect(cycleDueIn('2026-10', { closingDay: 10, dueDay: 25 }).closing).toBe(
        '2026-10-10',
      );
    });
  });

  describe('nextDueCycle', () => {
    it('should return the closed cycle not yet due (cerró el 29, vence el 11)', () => {
      expect(nextDueCycle('2026-10-30', visa).due).toBe('2026-11-11');
      expect(nextDueCycle('2026-11-11', visa).due).toBe('2026-11-11');
      expect(nextDueCycle('2026-11-12', visa).due).toBe('2026-12-11');
    });
  });
});
