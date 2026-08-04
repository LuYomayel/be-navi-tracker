import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SweatTestService } from './sweat-test.service';
import { CreateSweatTestDto } from './dto/sweat-test.dto';

@Controller('sweat-tests')
@UseGuards(JwtAuthGuard)
export class SweatTestController {
  constructor(private readonly sweatTestService: SweatTestService) {}

  @Get()
  async findAll(@Request() req) {
    const data = await this.sweatTestService.findAll(req.user.userId);
    return { success: true, data };
  }

  @Get('stats')
  async getStats(@Request() req) {
    const data = await this.sweatTestService.getStats(req.user.userId);
    return { success: true, data };
  }

  @Get('recommendation')
  async getRecommendation(
    @Request() req,
    @Query('trainingHours') trainingHours?: string,
  ) {
    const hours = trainingHours ? parseFloat(trainingHours) : 2;
    const data = await this.sweatTestService.getRecommendation(
      req.user.userId,
      Number.isFinite(hours) ? hours : 2,
    );
    return { success: true, data };
  }

  @Post()
  async create(@Request() req, @Body() dto: CreateSweatTestDto) {
    const data = await this.sweatTestService.create(req.user.userId, dto);
    return { success: true, data };
  }

  @Delete(':id')
  async remove(@Request() req, @Param('id') id: string) {
    await this.sweatTestService.remove(req.user.userId, id);
    return { success: true };
  }
}
