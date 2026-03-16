import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { GoogleCalendarService } from './google-calendar.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [CalendarController],
  providers: [CalendarService, GoogleCalendarService, PrismaService],
  exports: [CalendarService],
})
export class CalendarModule {}
