import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Req,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { GoalService } from './goal.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('goals')
@UseGuards(JwtAuthGuard)
export class GoalController {
  constructor(private readonly goalService: GoalService) {}

  @Get()
  async getAll(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    return { success: true, data: await this.goalService.getAll(userId) };
  }

  @Get('progress')
  async progress(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    return { success: true, data: await this.goalService.getProgress(userId) };
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    return { success: true, data: await this.goalService.create(body, userId) };
  }

  @Post(':id/contributions')
  async contribute(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    const res = await this.goalService.logContribution(userId, body, id);
    if (!res)
      throw new HttpException('Objetivo no encontrado', HttpStatus.NOT_FOUND);
    return { success: true, data: res };
  }

  @Put(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    await this.goalService.update(id, body, userId);
    return { success: true };
  }
}
