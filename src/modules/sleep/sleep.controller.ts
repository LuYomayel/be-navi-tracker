import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  SleepService,
  parseDuration,
  minutesBetween,
} from './sleep.service';
import { getLocalDateString } from '../../common/utils/date.utils';

@Controller('sleep')
@UseGuards(JwtAuthGuard)
export class SleepController {
  constructor(private readonly sleep: SleepService) {}

  @Get()
  async range(
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: any,
  ) {
    const hasta = to || getLocalDateString();
    const desde = from || hasta;
    return {
      success: true,
      data: await this.sleep.getRange(req.user.userId, desde, hasta),
    };
  }

  @Get('stats')
  async stats(@Query('days') days: string, @Req() req: any) {
    return {
      success: true,
      data: await this.sleep.getStats(req.user.userId, Number(days) || 7),
    };
  }

  @Get(':date')
  async byDate(@Param('date') date: string, @Req() req: any) {
    return {
      success: true,
      data: await this.sleep.getByDate(req.user.userId, date),
    };
  }

  @Post()
  async upsert(@Body() body: any, @Req() req: any) {
    // `duracion` acepta lo que mande el atajo ("7:45", "7h 30m", 465…) y, si
    // no viene, se calcula con los horarios.
    const minutes =
      parseDuration(body?.minutesAsleep ?? body?.duracion) ??
      minutesBetween(body?.bedTime ?? body?.acoste, body?.wakeTime ?? body?.desperte) ??
      0;
    return {
      success: true,
      data: await this.sleep.upsertSleep(req.user.userId, {
        ...body,
        date: body?.date || getLocalDateString(),
        minutesAsleep: minutes,
      }),
    };
  }

  @Delete(':date')
  async remove(@Param('date') date: string, @Req() req: any) {
    return {
      success: true,
      data: await this.sleep.delete(req.user.userId, date),
    };
  }
}
