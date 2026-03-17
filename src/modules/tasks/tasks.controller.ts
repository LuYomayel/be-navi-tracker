import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpException,
  HttpStatus, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(private readonly tasksService: TasksService) {}

  @Get()
  async findAll(
    @Req() req: any,
    @Query('date') date?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    try {
      const tasks = await this.tasksService.findAll(req.user.userId, {
        date,
        status,
        category,
        from,
        to,
      });
      return { success: true, data: tasks };
    } catch (error) {
      this.logger.error('Error fetching tasks:', error);
      return { success: false, error: 'Error fetching tasks' };
    }
  }

  @Get(':id')
  async findOne(@Req() req: any, @Param('id') id: string) {
    try {
      const task = await this.tasksService.findOne(req.user.userId, id);
      return { success: true, data: task };
    } catch (error) {
      throw new HttpException(
        error.message || 'Task not found',
        error.status || HttpStatus.NOT_FOUND,
      );
    }
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateTaskDto) {
    try {
      const task = await this.tasksService.create(req.user.userId, dto);
      return { success: true, data: task };
    } catch (error) {
      this.logger.error('Error creating task:', error);
      throw new HttpException(
        'Error creating task',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // PUT reorder MUST be before :id to avoid "reorder" being parsed as an id
  @Put('reorder')
  async reorder(@Req() req: any, @Body() body: { taskIds: string[] }) {
    try {
      const result = await this.tasksService.reorder(
        req.user.userId,
        body.taskIds,
      );
      return { success: true, data: result };
    } catch (error) {
      this.logger.error('Error reordering tasks:', error);
      throw new HttpException(
        'Error reordering tasks',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    try {
      const task = await this.tasksService.update(req.user.userId, id, dto);
      return { success: true, data: task };
    } catch (error) {
      throw new HttpException(
        error.message || 'Error updating task',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    try {
      await this.tasksService.remove(req.user.userId, id);
      return { success: true, message: 'Task deleted' };
    } catch (error) {
      throw new HttpException(
        error.message || 'Error deleting task',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/toggle')
  async toggle(@Req() req: any, @Param('id') id: string) {
    try {
      const task = await this.tasksService.toggle(req.user.userId, id);
      return { success: true, data: task };
    } catch (error) {
      throw new HttpException(
        error.message || 'Error toggling task',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
