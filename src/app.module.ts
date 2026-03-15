import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { SkinFoldModule } from './modules/skin-fold/skin-fold.module';
import { XpModule } from './modules/xp/xp.module';
import { PrismaService } from './config/prisma.service';
import { NotesModule } from './modules/notes/notes.module';
import { ScheduleModule } from '@nestjs/schedule';
import { PhysicalActivitiesModule } from './modules/physical-activities/physical-activities.module';
import { SavedMealsModule } from './modules/saved-meals/saved-meals.module';
import { AICostModule } from './modules/ai-cost/ai-cost.module';
@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 60,
    }]),
    ScheduleModule.forRoot(),
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
    SkinFoldModule,
    XpModule,
    NotesModule,
    PhysicalActivitiesModule,
    SavedMealsModule,
    AICostModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
