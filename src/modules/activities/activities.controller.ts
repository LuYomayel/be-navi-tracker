import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  HttpStatus,
  HttpException,
  UseGuards,
  Req,
  Param, Logger } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { Activity, ApiResponse } from '../../common/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('activities')
@UseGuards(JwtAuthGuard)
export class ActivitiesController {
  private readonly logger = new Logger(ActivitiesController.name);

  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  async getAll(
    @Req() req: any,
    @Query('archived') archived: boolean = false,
  ): Promise<ApiResponse<Activity[]>> {
    try {
      const activities = await this.activitiesService.getAll(
        req.user.userId,
        archived,
      );
      return { success: true, data: activities };
    } catch (error) {
      this.logger.error('Error al obtener actividades:', error);
      return {
        success: false,
        error: 'Error al obtener actividades',
      };
    }
  }

  @Post()
  async create(
    @Body() activityData: Omit<Activity, 'id' | 'createdAt' | 'updatedAt'>,
    @Req() req: any,
  ): Promise<ApiResponse<Activity>> {
    try {
      const activity = await this.activitiesService.create(
        activityData,
        req.user.userId,
      );
      return { success: true, data: activity };
    } catch (error) {
      this.logger.error('Error al crear actividad:', error);
      throw new HttpException(
        'Error al crear actividad',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put()
  async update(
    @Body() updateData: Partial<Activity> & { id: string },
    @Req() req: any,
  ): Promise<ApiResponse<Activity>> {
    try {
      const { id, ...updates } = updateData;
      const activity = await this.activitiesService.update(
        id,
        updates,
        req.user.userId,
      );
      return { success: true, data: activity };
    } catch (error) {
      this.logger.error('Error al actualizar actividad:', error);
      throw new HttpException(
        'Error al actualizar actividad',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  @Put('archive/:id')
  async archive(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<Activity>> {
    try {
      const activity = await this.activitiesService.archive(
        id,
        req.user.userId,
      );
      return { success: true, data: activity };
    } catch (error) {
      this.logger.error('Error al archivar actividad:', error);
      throw new HttpException(
        'Error al archivar actividad',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('restore/:id')
  async restore(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<Activity>> {
    try {
      const activity = await this.activitiesService.restore(
        id,
        req.user.userId,
      );
      return { success: true, data: activity };
    } catch (error) {
      this.logger.error('Error al restaurar actividad:', error);
      throw new HttpException(
        'Error al restaurar actividad',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete()
  async delete(
    @Query('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    try {
      if (!id) {
        throw new HttpException(
          'El ID de la actividad es requerido',
          HttpStatus.BAD_REQUEST,
        );
      }

      const success = await this.activitiesService.delete(id, req.user.userId);
      return { success, data: { deleted: success } };
    } catch (error) {
      this.logger.error('Error al eliminar actividad:', error);
      throw new HttpException(
        'Error al eliminar actividad',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
