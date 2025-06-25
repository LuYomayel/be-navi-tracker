import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { BodyAnalysis } from '../../common/types';

interface BodyAnalysisRequest {
  image: string; // Base64 encoded image
  currentWeight?: number;
  targetWeight?: number;
  height?: number;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goals?: string[];
  allowGeneric?: boolean;
}

interface BodyAnalysisResponse {
  measurements: {
    estimatedBodyFat?: number;
    muscleDefinition: 'low' | 'moderate' | 'high' | 'very_high';
    posture: 'poor' | 'fair' | 'good' | 'excellent';
    symmetry: 'poor' | 'fair' | 'good' | 'excellent';
    overallFitness: 'beginner' | 'intermediate' | 'advanced' | 'athlete';
  };
  bodyComposition: {
    estimatedBMI?: number;
    bodyType: 'ectomorph' | 'mesomorph' | 'endomorph' | 'mixed';
    muscleGroups: Array<{
      name: string;
      development:
        | 'underdeveloped'
        | 'developing'
        | 'well_developed'
        | 'highly_developed';
      recommendations: string[];
    }>;
  };
  recommendations: {
    nutrition: string[];
    priority:
      | 'weight_loss'
      | 'muscle_gain'
      | 'maintenance'
      | 'endurance'
      | 'strength';
  };
  progress: {
    strengths: string[];
    visibleWeakPoints: string[];
    postureAnalysis: string;
  };
  confidence: number;
  disclaimer: string;
}

@Injectable()
export class BodyAnalysisService {
  constructor(private prisma: PrismaService) {}

  async getAll(): Promise<BodyAnalysis[]> {
    try {
      const results = await this.prisma.bodyAnalysis.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return results as any[];
    } catch (error) {
      console.error('Error fetching body analyses:', error);
      return [];
    }
  }

  async create(
    data: Omit<BodyAnalysis, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<BodyAnalysis> {
    try {
      const analysis = (await this.prisma.bodyAnalysis.create({
        data: {
          ...data,
          measurements: (data.measurements as any) || {},
          bodyComposition: (data.bodyComposition as any) || {},
          recommendations: (data.recommendations as any) || {},
        },
      })) as any;
      return analysis;
    } catch (error) {
      console.error('Error creating body analysis:', error);
      throw new Error('Failed to create body analysis');
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.bodyAnalysis.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      console.error('Error deleting body analysis:', error);
      return false;
    }
  }

  async getLatest(): Promise<BodyAnalysis | null> {
    try {
      const result = await this.prisma.bodyAnalysis.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      return result as any;
    } catch (error) {
      console.error('Error fetching latest body analysis:', error);
      return null;
    }
  }

  // Función mock para análisis corporal (hasta que se configure OpenAI)
  getMockBodyAnalysis(
    userData: Omit<BodyAnalysisRequest, 'image'>,
  ): BodyAnalysisResponse {
    return {
      measurements: {
        estimatedBodyFat: 15,
        muscleDefinition: 'moderate',
        posture: 'good',
        symmetry: 'good',
        overallFitness: 'intermediate',
      },
      bodyComposition: {
        estimatedBMI: 22.5,
        bodyType: 'mesomorph',
        muscleGroups: [
          {
            name: 'Pecho',
            development: 'well_developed',
            recommendations: [
              'Mantener rutina actual',
              'Variar ángulos de trabajo',
            ],
          },
          {
            name: 'Espalda',
            development: 'developing',
            recommendations: [
              'Incrementar volumen',
              'Trabajar remo horizontal',
            ],
          },
          {
            name: 'Piernas',
            development: 'highly_developed',
            recommendations: [
              'Excelente desarrollo',
              'Mantener frecuencia actual',
            ],
          },
        ],
      },
      recommendations: {
        nutrition: [
          'Mantener ingesta proteica de 2.2g/kg',
          'Incluir carbohidratos complejos',
          'Hidratación adecuada',
        ],
        priority: 'muscle_gain',
      },
      progress: {
        strengths: [
          'Buena simetría general',
          'Desarrollo equilibrado de extremidades',
        ],
        visibleWeakPoints: [
          'Definición abdominal',
          'Desarrollo de hombros posteriores',
        ],
        postureAnalysis: 'Postura general buena, ligera protrusión de cabeza',
      },
      confidence: 0.75,
      disclaimer:
        'Este análisis es solo para fines informativos y de fitness. Consulta un profesional de la salud para evaluaciones médicas.',
    };
  }

  async analyzeBodyImage(
    imageBase64: string,
    userData: Omit<BodyAnalysisRequest, 'image'>,
  ): Promise<BodyAnalysisResponse> {
    // TODO: Implementar integración con OpenAI cuando se configure la API key
    // Por ahora, devolvemos datos mock
    return this.getMockBodyAnalysis(userData);
  }
}
