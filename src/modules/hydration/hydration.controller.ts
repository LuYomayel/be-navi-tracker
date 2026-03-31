import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HydrationService } from './hydration.service';
import { getLocalDateString } from '../../common/utils/date.utils';
import {
  AdjustHydrationDto,
  SetHydrationDto,
  SetGoalDto,
} from './dto/hydration.dto';

@Controller('hydration')
@UseGuards(JwtAuthGuard)
export class HydrationController {
  constructor(private readonly hydrationService: HydrationService) {}

  @Get()
  async getByDate(@Request() req, @Query('date') date?: string) {
    const targetDate =
      date || getLocalDateString();
    const data = await this.hydrationService.getByDate(
      req.user.userId,
      targetDate,
    );
    return { success: true, data };
  }

  @Get('range')
  async getRange(
    @Request() req,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const data = await this.hydrationService.getRange(
      req.user.userId,
      from,
      to,
    );
    return { success: true, data };
  }

  @Post('adjust')
  async adjust(@Request() req, @Body() dto: AdjustHydrationDto) {
    const data = await this.hydrationService.adjust(req.user.userId, dto);
    return { success: true, data };
  }

  @Put()
  async set(@Request() req, @Body() dto: SetHydrationDto) {
    const data = await this.hydrationService.set(req.user.userId, dto);
    return { success: true, data };
  }

  @Get('goal')
  async getGoal(@Request() req) {
    const data = await this.hydrationService.getGoal(req.user.userId);
    return { success: true, data };
  }

  @Put('goal')
  async setGoal(@Request() req, @Body() dto: SetGoalDto) {
    const data = await this.hydrationService.setGoal(req.user.userId, dto);
    return { success: true, data };
  }
}
