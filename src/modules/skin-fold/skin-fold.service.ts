import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import {
  CreateSkinFoldRecordDto,
  UpdateSkinFoldRecordDto,
  SkinFoldRecord,
  SkinFoldSite,
} from './dto/skin-fold.dto';
import OpenAI from 'openai';
import { AICostService } from '../ai-cost/ai-cost.service';

export interface AnthropometryAnalysis {
  basics: {
    weight: number;
    height: number;
    seatedHeight?: number;
    age?: number;
  };
  skinFolds: {
    triceps: number;
    subscapular: number;
    supraspinal: number;
    abdominal: number;
    thigh: number;
    calf: number;
    sumOfSix: number;
  };
  diameters: {
    biacromial: number;
    transverseThorax: number;
    anteroposteriorThorax: number;
    biIliocrestideal: number;
    humeral: number;
    femoral: number;
  };
  perimeters: {
    head: number;
    relaxedArm: number;
    flexedArm: number;
    forearm: number;
    mesosternalThorax: number;
    waist: number;
    hips: number;
    upperThigh: number;
    medialThigh: number;
    calf: number;
  };
  bodyComposition: {
    adipose: { percentage: number; kg: number };
    muscular: { percentage: number; kg: number };
    residual: { percentage: number; kg: number };
    bone: { percentage: number; kg: number };
    skin: { percentage: number; kg: number };
  };
  somatotype: {
    endomorphy: number;
    mesomorphy: number;
    ectomorphy: number;
  };
  indexes: {
    bmi: number;
    waistHipRatio: number;
    muscleToOsseousIndex: number;
    adiposeToMuscularIndex: number;
    bmr: number;
    idealWeight: number;
  };
  zScores: Record<string, number>;
}

@Injectable()
export class SkinFoldService {
  private openai: OpenAI | null = null;

  constructor(private prisma: PrismaService, private aiCostService: AICostService) {
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
          pdfUrl: data.pdfUrl,
          pdfFilename: data.pdfFilename,
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
          pdfUrl: data.pdfUrl,
          pdfFilename: data.pdfFilename,
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

  async analyzeAnthropometryPdf(
    images: string[],
    userId: string,
  ): Promise<{ record: SkinFoldRecord; fullAnalysis: AnthropometryAnalysis }> {
    if (!this.openai) {
      throw new BadRequestException(
        'OpenAI API key no configurada. No se puede analizar el PDF.',
      );
    }

    if (!images || images.length === 0) {
      throw new BadRequestException(
        'Se requiere al menos una imagen del PDF de antropometría',
      );
    }

    console.log(
      `Analizando PDF de antropometría con ${images.length} página(s)...`,
    );

    const imageContents: OpenAI.Chat.Completions.ChatCompletionContentPart[] =
      images.map((img) => {
        const imageUrl = img.startsWith('data:')
          ? img
          : `data:image/jpeg;base64,${img}`;
        return {
          type: 'image_url' as const,
          image_url: { url: imageUrl, detail: 'high' as const },
        };
      });

    const prompt = `Eres un experto en cineantropometría y composición corporal. Analiza estas imágenes de un informe de antropometría profesional (PDF escaneado) y extrae TODOS los datos numéricos con precisión.

El informe puede contener varias páginas con:
- Página de datos básicos: peso, talla, talla sentado, edad
- Mediciones de pliegues cutáneos (6 sitios): tríceps, subescapular, supraespinal, abdominal, muslo, pantorrilla
- Diámetros óseos (6 tipos): biacromial, tórax transverso, tórax anteroposterior, biiliocrestídeo, humeral, femoral
- Perímetros (10 tipos): cabeza, brazo relajado, brazo flexionado, antebrazo, tórax mesoesternal, cintura, cadera, muslo superior, muslo medial, pantorrilla
- Composición corporal por 5 componentes (D. Kerr 1988): adiposo, muscular, residual, óseo, piel (% y kg)
- Somatotipo (Heath & Carter): endomorfia, mesomorfia, ectomorfia
- Índices: IMC, índice cintura-cadera, índice músculo-óseo, índice adiposo-muscular, TMB (Harris & Benedict), peso ideal
- Z-Scores del Phantom para cada medición

INSTRUCCIONES:
1. Extrae los valores EXACTOS que aparecen en el informe, no los calcules
2. Si un valor no aparece en el informe, usa null
3. Para los Z-Scores, usa el nombre de la medición en español como clave
4. Los pliegues cutáneos están en mm, los diámetros y perímetros en cm, el peso en kg, la talla en cm

Responde ÚNICAMENTE con un JSON válido (sin bloques de código markdown):
{
  "basics": {
    "weight": null,
    "height": null,
    "seatedHeight": null,
    "age": null
  },
  "skinFolds": {
    "triceps": null,
    "subscapular": null,
    "supraspinal": null,
    "abdominal": null,
    "thigh": null,
    "calf": null,
    "sumOfSix": null
  },
  "diameters": {
    "biacromial": null,
    "transverseThorax": null,
    "anteroposteriorThorax": null,
    "biIliocrestideal": null,
    "humeral": null,
    "femoral": null
  },
  "perimeters": {
    "head": null,
    "relaxedArm": null,
    "flexedArm": null,
    "forearm": null,
    "mesosternalThorax": null,
    "waist": null,
    "hips": null,
    "upperThigh": null,
    "medialThigh": null,
    "calf": null
  },
  "bodyComposition": {
    "adipose": { "percentage": null, "kg": null },
    "muscular": { "percentage": null, "kg": null },
    "residual": { "percentage": null, "kg": null },
    "bone": { "percentage": null, "kg": null },
    "skin": { "percentage": null, "kg": null }
  },
  "somatotype": {
    "endomorphy": null,
    "mesomorphy": null,
    "ectomorphy": null
  },
  "indexes": {
    "bmi": null,
    "waistHipRatio": null,
    "muscleToOsseousIndex": null,
    "adiposeToMuscularIndex": null,
    "bmr": null,
    "idealWeight": null
  },
  "zScores": {}
}`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...imageContents,
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 4000,
      });

      // Log AI cost
      await this.aiCostService.logFromCompletion(userId, 'skin-fold-analyze-pdf', completion);

      const responseText = completion.choices[0]?.message?.content;
      if (!responseText) {
        throw new BadRequestException(
          'No se recibió respuesta de OpenAI al analizar el PDF',
        );
      }

      // Clean markdown code blocks if present
      let cleaned = responseText.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const analysis: AnthropometryAnalysis = JSON.parse(cleaned.trim());

      console.log('Análisis de antropometría completado exitosamente');

      // Map skin fold values from the analysis to the SkinFoldSite format
      const skinFoldValues: Partial<Record<SkinFoldSite, number>> = {};
      if (analysis.skinFolds) {
        if (analysis.skinFolds.triceps)
          skinFoldValues.triceps = analysis.skinFolds.triceps;
        if (analysis.skinFolds.subscapular)
          skinFoldValues.subscapular = analysis.skinFolds.subscapular;
        if (analysis.skinFolds.abdominal)
          skinFoldValues.abdominal = analysis.skinFolds.abdominal;
        if (analysis.skinFolds.thigh)
          skinFoldValues.thigh = analysis.skinFolds.thigh;
        if (analysis.skinFolds.calf)
          skinFoldValues.calf = analysis.skinFolds.calf;
      }

      // Return extracted data without creating a record
      // The frontend will create the record when the user clicks "Guardar"
      const extractedRecord: Partial<SkinFoldRecord> = {
        technician: 'Extraído de PDF por IA',
        values: skinFoldValues,
        aiConfidence: 0.9,
      };

      return {
        record: extractedRecord as SkinFoldRecord,
        fullAnalysis: analysis,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Error analyzing anthropometry PDF:', error);
      throw new BadRequestException(
        'Error al analizar el PDF de antropometría. Verifique que las imágenes sean legibles.',
      );
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
        latestRecord: records[0],
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
