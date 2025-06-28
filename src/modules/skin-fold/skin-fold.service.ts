import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import {
  CreateSkinFoldRecordDto,
  UpdateSkinFoldRecordDto,
  AnalyzeSkinFoldDto,
  SkinFoldRecord,
  SkinFoldSite,
} from './dto/skin-fold.dto';
import { Queue } from 'bullmq';
import OpenAI from 'openai';

@Injectable()
export class SkinFoldService {
  private openai: OpenAI | null = null;

  constructor(
    private prisma: PrismaService,
    @Inject('BODY_ANALYSIS_QUEUE')
    private readonly analysisQueue: Queue,
  ) {
    // Inicializar OpenAI solo si hay API key
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  async getAll(userId: string = 'default'): Promise<SkinFoldRecord[]> {
    try {
      const records = await this.prisma.skinFoldRecord.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
      });
      return records as SkinFoldRecord[];
    } catch (error) {
      console.error('Error fetching skin fold records:', error);
      throw new BadRequestException(
        'Error al obtener registros de pliegues cutáneos',
      );
    }
  }

  async getById(
    id: string,
    userId: string = 'default',
  ): Promise<SkinFoldRecord> {
    try {
      const record = await this.prisma.skinFoldRecord.findFirst({
        where: { id, userId },
      });

      if (!record) {
        throw new NotFoundException(
          'Registro de pliegues cutáneos no encontrado',
        );
      }

      return record as SkinFoldRecord;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('Error fetching skin fold record by id:', error);
      throw new BadRequestException(
        'Error al obtener registro de pliegues cutáneos',
      );
    }
  }

  async create(
    data: CreateSkinFoldRecordDto,
    userId: string = 'default',
  ): Promise<SkinFoldRecord> {
    try {
      // Validar que al menos una medición esté presente
      const measurementCount = Object.values(data.values).filter(
        (v) => typeof v === 'number' && v > 0,
      ).length;
      if (measurementCount === 0) {
        throw new BadRequestException(
          'Debe incluir al menos una medición de pliegue cutáneo',
        );
      }

      // Validar valores de medición (0-50mm es rango típico)
      for (const [site, value] of Object.entries(data.values)) {
        if (typeof value === 'number' && (value < 0 || value > 50)) {
          throw new BadRequestException(
            `Valor inválido para ${site}: ${value}mm. Rango válido: 0-50mm`,
          );
        }
      }

      const record = await this.prisma.skinFoldRecord.create({
        data: {
          userId,
          date: data.date,
          technician: data.technician,
          notes: data.notes,
          values: data.values,
          aiConfidence: data.aiConfidence,
        },
      });

      return record as SkinFoldRecord;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Error creating skin fold record:', error);
      throw new BadRequestException(
        'Error al crear registro de pliegues cutáneos',
      );
    }
  }

  async update(
    id: string,
    data: UpdateSkinFoldRecordDto,
    userId: string = 'default',
  ): Promise<SkinFoldRecord> {
    try {
      // Verificar que el registro existe y pertenece al usuario
      await this.getById(id, userId);

      // Validar valores si se proporcionan
      if (data.values) {
        for (const [site, value] of Object.entries(data.values)) {
          if (typeof value === 'number' && (value < 0 || value > 50)) {
            throw new BadRequestException(
              `Valor inválido para ${site}: ${value}mm. Rango válido: 0-50mm`,
            );
          }
        }
      }

      const updatedRecord = await this.prisma.skinFoldRecord.update({
        where: { id },
        data: {
          date: data.date,
          technician: data.technician,
          notes: data.notes,
          values: data.values,
          aiConfidence: data.aiConfidence,
        },
      });

      return updatedRecord as SkinFoldRecord;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      console.error('Error updating skin fold record:', error);
      throw new BadRequestException(
        'Error al actualizar registro de pliegues cutáneos',
      );
    }
  }

  async delete(id: string, userId: string = 'default'): Promise<boolean> {
    try {
      // Verificar que el registro existe y pertenece al usuario
      await this.getById(id, userId);

      await this.prisma.skinFoldRecord.delete({
        where: { id },
      });

      return true;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('Error deleting skin fold record:', error);
      throw new BadRequestException(
        'Error al eliminar registro de pliegues cutáneos',
      );
    }
  }

  async analyzeSkinFold(
    data: AnalyzeSkinFoldDto,
    userId: string = 'default',
  ): Promise<{ taskId: string; status: string }> {
    try {
      // Validar imagen base64
      if (!data.imageBase64 || data.imageBase64.length === 0) {
        throw new BadRequestException('Imagen requerida para análisis');
      }

      // Crear trabajo en la cola para análisis de pliegues cutáneos
      const job = await this.analysisQueue.add('skinFoldAnalysis', {
        image: `data:image/jpeg;base64,${data.imageBase64}`,
        userData: {
          ...data.user,
          userId,
          analysisType: 'skinfold',
        },
      });

      return {
        taskId: job.id as string,
        status: 'queued',
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Error analyzing skin fold:', error);
      throw new BadRequestException('Error al analizar pliegues cutáneos');
    }
  }

  async getStatistics(userId: string = 'default'): Promise<{
    totalRecords: number;
    averageBodyFat?: number;
    latestRecord?: SkinFoldRecord;
    sitesFrequency: Record<SkinFoldSite, number>;
  }> {
    try {
      const records = await this.getAll(userId);

      if (records.length === 0) {
        return {
          totalRecords: 0,
          sitesFrequency: {} as Record<SkinFoldSite, number>,
        };
      }

      // Calcular frecuencia de sitios medidos
      const sitesFrequency: Record<string, number> = {};
      records.forEach((record) => {
        Object.keys(record.values).forEach((site) => {
          if (typeof record.values[site as SkinFoldSite] === 'number') {
            sitesFrequency[site] = (sitesFrequency[site] || 0) + 1;
          }
        });
      });

      return {
        totalRecords: records.length,
        latestRecord: records[0], // Ya están ordenados por fecha desc
        sitesFrequency: sitesFrequency as Record<SkinFoldSite, number>,
      };
    } catch (error) {
      console.error('Error getting skin fold statistics:', error);
      throw new BadRequestException(
        'Error al obtener estadísticas de pliegues cutáneos',
      );
    }
  }

  calculateBodyFatPercentage(
    values: Partial<Record<SkinFoldSite, number>>,
    age: number,
    gender: 'male' | 'female',
  ): number | null {
    try {
      // Fórmula de Jackson-Pollock de 3 sitios
      if (gender === 'male') {
        // Hombres: pectoral, abdominal, muslo
        const chest = values.chest;
        const abdominal = values.abdominal;
        const thigh = values.thigh;

        if (chest && abdominal && thigh) {
          const sum = chest + abdominal + thigh;
          const density =
            1.10938 - 0.0008267 * sum + 0.0000016 * sum * sum - 0.0002574 * age;
          const bodyFat = 495 / density - 450;
          return Math.round(bodyFat * 10) / 10;
        }
      } else {
        // Mujeres: tríceps, supraespinal, muslo
        const triceps = values.triceps;
        const suprailiac = values.suprailiac;
        const thigh = values.thigh;

        if (triceps && suprailiac && thigh) {
          const sum = triceps + suprailiac + thigh;
          const density =
            1.0994921 -
            0.0009929 * sum +
            0.0000023 * sum * sum -
            0.0001392 * age;
          const bodyFat = 495 / density - 450;
          return Math.round(bodyFat * 10) / 10;
        }
      }

      return null;
    } catch (error) {
      console.error('Error calculating body fat percentage:', error);
      return null;
    }
  }
}
