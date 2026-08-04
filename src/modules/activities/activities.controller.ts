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
  Param,
} from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { Activity, ApiResponse } from '../../common/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('activities')
@UseGuards(JwtAuthGuard)
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  async getAll(
    @Req() req: any,
    @Query('archived') archived: boolean = false,
  ): Promise<ApiResponse<Activity[]>> {
    const activities = await this.activitiesService.getAll(
      req.user.userId,
      archived,
    );
    return { success: true, data: activities };
  }

  @Post()
  async create(
    @Body() activityData: Omit<Activity, 'id' | 'createdAt' | 'updatedAt'>,
    @Req() req: any,
  ): Promise<ApiResponse<Activity>> {
    const activity = await this.activitiesService.create(
      activityData,
      req.user.userId,
    );
    return { success: true, data: activity };
  }

  @Put()
  async update(
    @Body() updateData: Partial<Activity> & { id: string },
    @Req() req: any,
  ): Promise<ApiResponse<Activity>> {
    const { id, ...updates } = updateData;
    const activity = await this.activitiesService.update(
      id,
      updates,
      req.user.userId,
    );
    return { success: true, data: activity };
  }

  @Put('archive/:id')
  async archive(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<Activity>> {
    const activity = await this.activitiesService.archive(id, req.user.userId);
    return { success: true, data: activity };
  }

  @Put('restore/:id')
  async restore(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<Activity>> {
    const activity = await this.activitiesService.restore(id, req.user.userId);
    return { success: true, data: activity };
  }

  @Delete()
  async delete(
    @Query('id') id: string,
    @Req() req: any,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    if (!id) {
      throw new HttpException(
        'El ID de la actividad es requerido',
        HttpStatus.BAD_REQUEST,
      );
    }

    const success = await this.activitiesService.delete(id, req.user.userId);
    return { success, data: { deleted: success } };
  }
}
