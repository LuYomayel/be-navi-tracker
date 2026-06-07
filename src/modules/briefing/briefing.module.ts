import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { DayScoreModule } from '../day-score/day-score.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { TasksModule } from '../tasks/tasks.module';
import { ActivitiesModule } from '../activities/activities.module';
import { HydrationModule } from '../hydration/hydration.module';
import { GoalModule } from '../goal/goal.module';
import { CalendarModule } from '../calendar/calendar.module';
import { TrelloModule } from '../trello/trello.module';
import { AICostModule } from '../ai-cost/ai-cost.module';
import { DeviceTokensModule } from '../device-tokens/device-tokens.module';

import { BriefingService } from './briefing.service';
import { EmailService } from './email.service';
import { BriefingController } from './briefing.controller';
import { BriefingCronService } from './briefing-cron.service';

/**
 * Briefing diario de NaviTracker: agrega el dia (habitos, tareas, nutricion,
 * day-score, hidratacion, objetivo NZ), lo persiste, lo manda por mail (Resend)
 * y lo expone por endpoint + cron 07:00 ART. Reutiliza los servicios de dominio.
 */
@Module({
  imports: [
    DayScoreModule,
    NutritionModule,
    TasksModule,
    ActivitiesModule,
    HydrationModule,
    GoalModule,
    CalendarModule,
    TrelloModule,
    AICostModule,
    DeviceTokensModule,
  ],
  controllers: [BriefingController],
  providers: [
    BriefingService,
    EmailService,
    BriefingCronService,
    PrismaService,
  ],
  exports: [BriefingService],
})
export class BriefingModule {}
