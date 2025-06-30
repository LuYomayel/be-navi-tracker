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
import { PhysicalActivitiesService } from './physical-activities.service';
import { PhysicalActivity, ApiResponse } from '../../common/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatePhysicalActivityDto } from './dto/create-physical-activity.dto';
import { XpService } from '../xp/xp.service';
import { XpAction } from '../xp/dto/xp.dto';

@Controller('physical-activities')
@UseGuards(JwtAuthGuard)
export class PhysicalActivitiesController {
  constructor(
    private readonly physicalActivitiesService: PhysicalActivitiesService,
    private readonly xpService: XpService,
  ) {}

  @Post()
  async create(@Req() req, @Body() dto: CreatePhysicalActivityDto) {
    try {
      const userId = req?.user?.userId || 'usr_test_id_123'; // Fallback para testing

      if (dto.source === 'image' && dto.screenshotUrl) {
        const activity =
          await this.physicalActivitiesService.analyzeImagePhysicalActivity(
            dto.screenshotUrl,
          );
        if (!activity) {
          throw new HttpException(
            'No se pudo analizar la imagen de la actividad física',
            HttpStatus.BAD_REQUEST,
          );
        }
        const createdActivity = await this.physicalActivitiesService.create(
          activity,
          userId,
        );

        // Agregar XP por actividad física (+60 XP)
        await this.xpService.addXp(userId, {
          action: XpAction.PHYSICAL_ACTIVITY,
          xpAmount: 60,
          description: 'Actividad física registrada',
          metadata: {
            activityType: 'image_analysis',
            calories: activity.activeEnergyKcal,
          },
        });

        return { success: true, data: createdActivity };
      }

      const activity = await this.physicalActivitiesService.create(dto, userId);

      // Agregar XP por actividad física (+60 XP)
      await this.xpService.addXp(userId, {
        action: XpAction.PHYSICAL_ACTIVITY,
        xpAmount: 60,
        description: 'Actividad física registrada',
        metadata: {
          activityType: 'manual',
          calories: dto.activeEnergyKcal,
        },
      });

      return { success: true, data: activity };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get()
  async findAll(@Req() req) {
    try {
      const userId = req?.user?.userId || 'usr_test_id_123'; // Fallback para testing
      const activities = await this.physicalActivitiesService.getAll(userId);
      return { success: true, data: activities };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Put(':id')
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body()
    dto: Omit<
      PhysicalActivity,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'user'
    >,
  ) {
    try {
      const userId = req?.user?.userId || 'usr_test_id_123'; // Fallback para testing
      return this.physicalActivitiesService.update(id, dto);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      return this.physicalActivitiesService.delete(id);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }
}
