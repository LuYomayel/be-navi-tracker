import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PrismaService } from './config/prisma.service';

@Module({
  imports: [
    ActivitiesModule,
    ChatModule,
    NutritionModule,
    CompletionsModule,
    AnalyzeFoodModule,
    BodyAnalysisModule,
    AiSuggestionsModule,
    AnalysisModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
