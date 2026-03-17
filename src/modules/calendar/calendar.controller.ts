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
import { CalendarService } from './calendar.service';
import { GoogleCalendarService } from './google-calendar.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

@Controller('calendar')
@UseGuards(JwtAuthGuard)
export class CalendarController {
  private readonly logger = new Logger(CalendarController.name);

  constructor(
    private readonly calendarService: CalendarService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  // ==========================================
  // CALENDAR EVENTS
  // ==========================================

  @Get('events')
  async getEvents(
    @Req() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    try {
      const events = await this.calendarService.getEvents(
        req.user.userId,
        from,
        to,
      );
      return { success: true, data: events };
    } catch (error) {
      this.logger.error('Error fetching events:', error);
      return { success: false, error: 'Error fetching events' };
    }
  }

  @Post('events')
  async createEvent(@Req() req: any, @Body() dto: CreateEventDto) {
    try {
      const event = await this.calendarService.createEvent(
        req.user.userId,
        dto,
      );
      return { success: true, data: event };
    } catch (error) {
      this.logger.error('Error creating event:', error);
      throw new HttpException(
        'Error creating event',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('events/:id')
  async updateEvent(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
  ) {
    try {
      const event = await this.calendarService.updateEvent(
        req.user.userId,
        id,
        dto,
      );
      return { success: true, data: event };
    } catch (error) {
      throw new HttpException(
        error.message || 'Error updating event',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('events/:id')
  async deleteEvent(@Req() req: any, @Param('id') id: string) {
    try {
      await this.calendarService.deleteEvent(req.user.userId, id);
      return { success: true, message: 'Event deleted' };
    } catch (error) {
      throw new HttpException(
        error.message || 'Error deleting event',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================
  // GOOGLE CALENDAR
  // ==========================================

  @Get('google/auth-url')
  async getGoogleAuthUrl(@Req() req: any) {
    try {
      const data = await this.googleCalendarService.getAuthUrl(
        req.user.userId,
      );
      return { success: true, data };
    } catch (error) {
      throw new HttpException(
        error.message || 'Google Calendar not configured',
        error.status || HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Post('google/callback')
  async googleCallback(
    @Req() req: any,
    @Body() body: { code: string },
  ) {
    try {
      const result = await this.googleCalendarService.handleCallback(
        req.user.userId,
        body.code,
      );
      return { success: true, data: result };
    } catch (error) {
      this.logger.error('Google Calendar callback error:', error);
      throw new HttpException(
        'Error connecting Google Calendar',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('google/sync')
  async syncGoogle(@Req() req: any) {
    try {
      const result = await this.googleCalendarService.sync(
        req.user.userId,
      );
      return { success: true, data: result };
    } catch (error) {
      throw new HttpException(
        error.message || 'Error syncing Google Calendar',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('google/disconnect')
  async disconnectGoogle(@Req() req: any) {
    try {
      const result = await this.googleCalendarService.disconnect(
        req.user.userId,
      );
      return { success: true, data: result };
    } catch (error) {
      throw new HttpException(
        'Error disconnecting Google Calendar',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('google/status')
  async googleStatus(@Req() req: any) {
    try {
      const data = await this.googleCalendarService.getStatus(
        req.user.userId,
      );
      return { success: true, data };
    } catch (error) {
      return {
        success: true,
        data: { connected: false, syncEnabled: false },
      };
    }
  }
}
