import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { CreatePhysicalActivityDto } from '../modules/physical-activities/dto/create-physical-activity.dto';
import { SaveDTO } from '../modules/body-analysis/dto/save-body-analysis.dto';

/**
 * El ValidationPipe global corre con `whitelist: true` (ver main.ts): descarta
 * del body toda propiedad que el DTO no declare. El detalle peligroso es que
 * una clase SIN decoradores queda whitelisteada a CERO campos y el body llega
 * vacio, sin ningun error. Estos tests fijan que los DTOs que se spreadean
 * directo a Prisma sigan conservando sus campos.
 */
describe('ValidationPipe global (whitelist)', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });

  const meta = (metatype: any): ArgumentMetadata => ({
    type: 'body',
    metatype,
    data: '',
  });

  describe('CreatePhysicalActivityDto', () => {
    it('conserva los campos declarados', async () => {
      const body = {
        date: '2025-06-30',
        steps: 8000,
        distanceKm: 5.2,
        activeEnergyKcal: 400,
        exerciseMinutes: 45,
        standHours: 10,
        screenshotUrl: 'https://example.com/a.png',
        source: 'image',
        aiConfidence: 0.9,
        context: 'corrida en el parque',
      };

      const result = await pipe.transform({ ...body }, meta(CreatePhysicalActivityDto));

      expect(result).toEqual(body);
    });

    it('descarta las propiedades no declaradas', async () => {
      const result: any = await pipe.transform(
        { date: '2025-06-30', source: 'manual', userId: 'otro-user', id: 'x' },
        meta(CreatePhysicalActivityDto),
      );

      expect(result.userId).toBeUndefined();
      expect(result.id).toBeUndefined();
      expect(result.date).toBe('2025-06-30');
    });
  });

  describe('SaveDTO', () => {
    it('conserva los blobs del analisis corporal', async () => {
      const body = {
        bodyType: 'mesomorph',
        confidence: 0.8,
        fullAnalysisData: { measurements: { bmi: 22 } },
        measurements: { bodyFat: 15, muscleMass: 40, bmi: 22 },
        recommendations: ['comer mejor'],
      };

      const result = await pipe.transform({ ...body }, meta(SaveDTO));

      expect(result).toEqual(body);
    });

    it('descarta las propiedades no declaradas', async () => {
      const result: any = await pipe.transform(
        { bodyType: 'mesomorph', userId: 'otro-user' },
        meta(SaveDTO),
      );

      expect(result.userId).toBeUndefined();
      expect(result.bodyType).toBe('mesomorph');
    });
  });
});
