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
    try {
      const activities = await this.activitiesService.getAll(
        req.user.userId,
        archived,
      );
      return { success: true, data: activities };
    } catch (error) {
      console.error('Error fetching activities:', error);
      return {
        success: false,
        error: 'Failed to fetch activities',
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
      console.error('Error creating activity:', error);
      throw new HttpException(
        'Failed to create activity',
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
      console.error('Error updating activity:', error);
      throw new HttpException(
        'Failed to update activity',
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
      console.error('Error archiving activity:', error);
      throw new HttpException(
        'Failed to archive activity',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete()
  async delete(
    @Query('id') id: string,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    try {
      if (!id) {
        throw new HttpException(
          'Activity ID is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const success = await this.activitiesService.delete(id);
      return { success, data: { deleted: success } };
    } catch (error) {
      console.error('Error deleting activity:', error);
      throw new HttpException(
        'Failed to delete activity',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
