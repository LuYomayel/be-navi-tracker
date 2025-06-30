import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { PhysicalActivity, ApiResponse } from '../../common/types';
import { CreatePhysicalActivityDto } from './dto/create-physical-activity.dto';
import { OpenAI } from 'openai';

@Injectable()
export class PhysicalActivitiesService {
  private openai: OpenAI | null = null;
  constructor(private prisma: PrismaService) {
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
      console.error('Error fetching activities:', error);
      return [];
    }
  }

  async analyzeImagePhysicalActivity(
    imageBase64: string,
  ): Promise<PhysicalActivity | null> {
    if (!this.openai) {
      console.log('OpenAI no disponible, usando análisis de fallback');
      return null;
    }

    try {
      // Generar prompt especializado para análisis de comida

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `Vas a analizar una foto de una actividad física y vas a devolver un objeto con los datos de la actividad física.
            - Probablemente la imagen sea de alguna aplicacion al estilo de Strava, Nike Run Club, etc.
            - Devolver unicamente un objeto con la siguiente estructura:
            {
              date: string; // yyyy-MM-dd (UTC 00:00)
              steps: number;
              distanceKm: number;
              activeEnergyKcal: number;
              exerciseMinutes: number;
              standHours: number;
              aiConfidence: number;
              screenshotUrl: string;
              source: 'image';
            }
            `,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analiza la imagen y devuelve un objeto con los datos de la actividad física. La imagen es de una actividad física. En ai confidence, devuelve un numero entre 0 y 1 de la confianza de que los datos son correctos.`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64,
                  detail: 'high',
                },
              },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0.2, // Muy conservador para análisis nutricional preciso
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No se recibió respuesta de OpenAI Vision');
      }
      const validatedResponse = JSON.parse(this.cleanOpenAIResponse(response));
      const isResponseValid =
        validatedResponse.date &&
        (validatedResponse.steps || validatedResponse.steps === 0) &&
        (validatedResponse.distanceKm || validatedResponse.distanceKm === 0) &&
        (validatedResponse.activeEnergyKcal ||
          validatedResponse.activeEnergyKcal === 0) &&
        (validatedResponse.exerciseMinutes ||
          validatedResponse.exerciseMinutes === 0) &&
        (validatedResponse.standHours || validatedResponse.standHours === 0) &&
        validatedResponse.aiConfidence &&
        validatedResponse.screenshotUrl &&
        validatedResponse.source;
      console.log('validatedResponse', validatedResponse);
      if (!isResponseValid) {
        throw new Error('La respuesta de OpenAI Vision no es válida');
      }

      console.log('✅ Análisis de comida generado con OpenAI Vision');
      return validatedResponse;
    } catch (error) {
      console.error('Error analizando imagen de comida con OpenAI:', error);
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
      console.error('Error creating activity:', error);
      throw new Error('Failed to create activity');
    }
  }

  async update(
    id: string,
    data: Omit<
      PhysicalActivity,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'user'
    >,
  ): Promise<PhysicalActivity | null> {
    try {
      const activity = await this.prisma.physicalActivity.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });

      return {
        ...activity,
      };
    } catch (error) {
      console.error('Error updating activity:', error);
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.physicalActivity.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      console.error('Error deleting activity:', error);
      return false;
    }
  }
}
