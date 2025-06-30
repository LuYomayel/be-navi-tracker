import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ActivitiesModule } from './modules/activities/activities.module';
import { ChatModule } from './modules/chat/chat.module';
import { NutritionModule } from './modules/nutrition/nutrition.module';
import { CompletionsModule } from './modules/completions/completions.module';
import { AnalyzeFoodModule } from './modules/analyze-food/analyze-food.module';
import { BodyAnalysisModule } from './modules/body-analysis/body-analysis.module';
import { AiSuggestionsModule } from './modules/ai-suggestions/ai-suggestions.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { AuthModule } from './modules/auth/auth.module';
import { PreferencesModule } from './modules/preferences/preferences.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { SkinFoldModule } from './modules/skin-fold/skin-fold.module';
import { XpModule } from './modules/xp/xp.module';
import { PrismaService } from './config/prisma.service';
import { QueueModule } from './queue/queue.module';
import { NotesModule } from './modules/notes/notes.module';
import { ScheduleModule } from '@nestjs/schedule';
import { PhysicalActivitiesModule } from './modules/physical-activities/physical-activities.module';
@Module({
  imports: [
    ScheduleModule.forRoot(),
    QueueModule,
    ActivitiesModule,
    ChatModule,
    NutritionModule,
    CompletionsModule,
    AnalyzeFoodModule,
    BodyAnalysisModule,
    AiSuggestionsModule,
    AnalysisModule,
    AuthModule,
    PreferencesModule,
    TasksModule,
    SkinFoldModule,
    XpModule,
    NotesModule,
    PhysicalActivitiesModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
