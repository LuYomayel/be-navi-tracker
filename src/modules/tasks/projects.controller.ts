import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { getLocalDateString } from '../../common/utils/date.utils';
import { ProjectsService } from './projects.service';
import {
  CreateMilestoneDto,
  CreateProjectDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
} from './dto/project.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('projects')
  async list(@Req() req: any, @Query('includeArchived') inc?: string) {
    const data = await this.projects.list(
      req.user.userId,
      getLocalDateString(),
      inc === 'true',
    );
    return { success: true, data };
  }

  @Get('projects/:id')
  async get(@Req() req: any, @Param('id') id: string) {
    const data = await this.projects.get(
      req.user.userId,
      id,
      getLocalDateString(),
    );
    return { success: true, data };
  }

  @Post('projects')
  async create(@Req() req: any, @Body() dto: CreateProjectDto) {
    const data = await this.projects.create(req.user.userId, dto);
    return { success: true, data };
  }

  @Put('projects/:id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const data = await this.projects.update(req.user.userId, id, dto);
    return { success: true, data };
  }

  @Delete('projects/:id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const data = await this.projects.remove(req.user.userId, id);
    return { success: true, data };
  }

  @Post('projects/:id/milestones')
  async createMilestone(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    const data = await this.projects.createMilestone(req.user.userId, id, dto);
    return { success: true, data };
  }

  @Put('milestones/:id')
  async updateMilestone(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    const data = await this.projects.updateMilestone(req.user.userId, id, dto);
    return { success: true, data };
  }

  @Delete('milestones/:id')
  async removeMilestone(@Req() req: any, @Param('id') id: string) {
    const data = await this.projects.removeMilestone(req.user.userId, id);
    return { success: true, data };
  }
}
