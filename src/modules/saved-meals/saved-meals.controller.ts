import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Req, UseGuards, HttpException, HttpStatus,
} from '@nestjs/common';
import { SavedMealsService } from './saved-meals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('saved-meals')
@UseGuards(JwtAuthGuard)
export class SavedMealsController {
  constructor(private readonly savedMealsService: SavedMealsService) {}

  @Get()
  async getAll(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    const meals = await this.savedMealsService.getAll(userId);
    return { success: true, data: meals };
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    const meal = await this.savedMealsService.create(body, userId);
    return { success: true, data: meal };
  }

  @Post(':id/use')
  async use(@Req() req: any, @Param('id') id: string) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    const meal = await this.savedMealsService.use(id, userId);
    if (!meal) throw new HttpException('Comida no encontrada', HttpStatus.NOT_FOUND);
    return { success: true, data: meal };
  }

  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    await this.savedMealsService.delete(id, userId);
    return { success: true };
  }

  @Put(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    await this.savedMealsService.update(id, body, userId);
    return { success: true };
  }
}
