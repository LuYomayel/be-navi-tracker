import { Controller, Get, Param, Inject } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { ApiResponse } from '../../common/types';

@Controller('tasks')
export class TasksController {
  constructor(
    @Inject('BODY_ANALYSIS_QUEUE')
    private readonly analysisQueue: Queue,
  ) {}

  @Get(':id/status')
  async getStatus(@Param('id') id: string): Promise<ApiResponse<any>> {
    try {
      const job = await Job.fromId(this.analysisQueue, id);

      if (!job) {
        return {
          success: false,
          error: 'Trabajo no encontrado',
        };
      }

      const status = job.finishedOn
        ? job.failedReason
          ? 'failed'
          : 'completed'
        : 'processing';

      return {
        success: true,
        data: {
          id: job.id,
          status,
          progress: job.progress || 0,
          createdAt: new Date(job.timestamp),
          finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
          error: job.failedReason || null,
        },
      };
    } catch (error) {
      console.error('Error obteniendo estado del trabajo:', error);
      return {
        success: false,
        error: 'Error interno del servidor',
      };
    }
  }

  @Get(':id/result')
  async getResult(@Param('id') id: string): Promise<ApiResponse<any>> {
    try {
      const job = await Job.fromId(this.analysisQueue, id);

      if (!job) {
        return {
          success: false,
          error: 'Trabajo no encontrado',
        };
      }

      if (!job.finishedOn) {
        return {
          success: false,
          error: 'El trabajo aún está procesándose',
        };
      }

      if (job.failedReason) {
        return {
          success: false,
          error: `El trabajo falló: ${job.failedReason}`,
        };
      }

      return {
        success: true,
        data: job.returnvalue,
      };
    } catch (error) {
      console.error('Error obteniendo resultado del trabajo:', error);
      return {
        success: false,
        error: 'Error interno del servidor',
      };
    }
  }

  @Get(':id')
  async getJobInfo(@Param('id') id: string): Promise<ApiResponse<any>> {
    try {
      const job = await Job.fromId(this.analysisQueue, id);

      if (!job) {
        return {
          success: false,
          error: 'Trabajo no encontrado',
        };
      }

      const status = job.finishedOn
        ? job.failedReason
          ? 'failed'
          : 'completed'
        : 'processing';

      return {
        success: true,
        data: {
          id: job.id,
          status,
          progress: job.progress || 0,
          createdAt: new Date(job.timestamp),
          finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
          error: job.failedReason || null,
          result: job.finishedOn && !job.failedReason ? job.returnvalue : null,
        },
      };
    } catch (error) {
      console.error('Error obteniendo información del trabajo:', error);
      return {
        success: false,
        error: 'Error interno del servidor',
      };
    }
  }
}
