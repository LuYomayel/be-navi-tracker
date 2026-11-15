import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { PhysicalActivity, ApiResponse } from '../../common/types';
import { CreatePhysicalActivityDto } from './dto/create-physical-activity.dto';
import { OpenAI } from 'openai';
import { resolveImageUrl } from '../../common/utils/image.utils';
import { AICostService } from '../ai-cost/ai-cost.service';
import { getLocalDateString } from '../../common/utils/date.utils';
import { aiJsonParams } from '../../common/ai/ai-model';

@Injectable()
export class PhysicalActivitiesService {
  private readonly logger = new Logger(PhysicalActivitiesService.name);

  private openai: OpenAI | null = null;
  constructor(private prisma: PrismaService, private aiCostService: AICostService) {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  async getAll(userId: string): Promise<PhysicalActivity[]> {
    try {
      const activities = await this.prisma.physicalActivity.findMany({
        where: { user: { id: userId } },
        orderBy: { createdAt: 'asc' },
      });

      return activities;
    } catch (error) {
      this.logger.error('Error al obtener actividades físicas:', error);
      return [];
    }
  }

  async analyzeImagePhysicalActivity(
    imageBase64: string,
    context?: string,
    userId?: string,
    todayDate?: string,
  ): Promise<(PhysicalActivity & { aiCostUsd?: number | null }) | null> {
    if (!this.openai) {
      this.logger.log('OpenAI no disponible, usando análisis de fallback');
      return null;
    }

    try {
      // Generar prompt especializado para análisis de comida

      const completion = await this.openai.chat.completions.create({
        ...aiJsonParams(2000, 'low'),
        messages: [
          {
            role: 'system',
            content: `Vas a analizar una foto de una actividad física y vas a devolver un objeto con los datos de la actividad física.
            - Probablemente la imagen sea de alguna aplicacion al estilo de Strava, Nike Run Club, etc.
            - La fecha de hoy es: ${todayDate || getLocalDateString()}. Si no podés determinar la fecha exacta de la actividad desde la imagen, usá esta fecha.
            - Devolver unicamente un objeto con la siguiente estructura:
            {
              date: string; // yyyy-MM-dd (UTC 00:00)
              steps: number;
              distanceKm: number;
              activeEnergyKcal: number;
              exerciseMinutes: number;
              standHours: number;
              aiConfidence: number;
            }
            - Si un dato no aparece en la imagen, poné 0.
            - Respondé SOLO el JSON, sin markdown.
            `,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analiza la imagen y devuelve un objeto con los datos de la actividad física. La imagen es de una actividad física. En ai confidence, devuelve un numero entre 0 y 1 de la confianza de que los datos son correctos.${context ? '\n\nCONTEXTO DEL USUARIO: ' + context : ''}`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: resolveImageUrl(imageBase64),
                  detail: 'high',
                },
              },
            ],
          },
        ],
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No se recibió respuesta de OpenAI Vision');
      }

      // Log AI cost
      if (userId) {
        await this.aiCostService.logFromCompletion(userId, 'physical-activity-image', completion);
      }

      // Extraer costo de la llamada
      const usage = completion.usage;
      const costUsd = usage ? this.aiCostService.calculateCost(usage.prompt_tokens, usage.completion_tokens) : null;

      const parsed = JSON.parse(this.cleanOpenAIResponse(response));
      // Se exigen la fecha y las metricas (0 es un valor valido). La URL de la
      // captura y el origen no los puede saber el modelo: los pone el server.
      const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
      const isResponseValid =
        typeof parsed?.date === 'string' &&
        [
          parsed.steps,
          parsed.distanceKm,
          parsed.activeEnergyKcal,
          parsed.exerciseMinutes,
          parsed.standHours,
        ].every(isNum);
      if (!isResponseValid) {
        throw new Error('La respuesta de OpenAI Vision no es válida');
      }
      const validatedResponse = {
        ...parsed,
        aiConfidence: isNum(parsed.aiConfidence) ? parsed.aiConfidence : 0.8,
        screenshotUrl: null,
        source: 'image',
      };

      return { ...validatedResponse, aiCostUsd: costUsd };
    } catch (error) {
      this.logger.error('Error analizando imagen de comida con OpenAI:', error);
      // Fallback a análisis predefinido
      return null;
    }
  }


  private cleanOpenAIResponse(response: string): string {
    let cleaned = response.trim();

    // Eliminar bloques de código markdown (```json ... ``` o ``` ... ```)
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    return cleaned.trim();
  }
  async create(
    data: CreatePhysicalActivityDto,
    userId: string,
  ): Promise<PhysicalActivity> {
    try {
      const activity = await this.prisma.physicalActivity.create({
        data: {
          ...data,
          userId,
        },
      });

      return {
        ...activity,
      };
    } catch (error) {
      this.logger.error('Error al crear actividad física:', error);
      throw new Error('Error al crear actividad física');
    }
  }

  async update(
    id: string,
    data: Omit<
      PhysicalActivity,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'user'
    >,
    userId: string,
  ): Promise<PhysicalActivity | null> {
    try {
      const activity = await this.prisma.physicalActivity.update({
        where: { id, userId },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });

      return {
        ...activity,
      };
    } catch (error) {
      this.logger.error('Error al actualizar actividad física:', error);
      return null;
    }
  }

  async delete(id: string, userId: string): Promise<boolean> {
    try {
      await this.prisma.physicalActivity.deleteMany({
        where: { id, userId },
      });
      return true;
    } catch (error) {
      this.logger.error('Error al eliminar actividad física:', error);
      return false;
    }
  }
}
