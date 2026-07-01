import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { PrismaService } from '../../config/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { HydrationModule } from '../hydration/hydration.module';
import { CompletionsModule } from '../completions/completions.module';
import { ActivitiesModule } from '../activities/activities.module';
import { DayScoreModule } from '../day-score/day-score.module';
import { TasksModule } from '../tasks/tasks.module';
import { SavedMealsModule } from '../saved-meals/saved-meals.module';
import { BriefingModule } from '../briefing/briefing.module';
import { AnalyzeFoodModule } from '../analyze-food/analyze-food.module';
import { TrelloModule } from '../trello/trello.module';
import { GoalModule } from '../goal/goal.module';
import { NotesModule } from '../notes/notes.module';
import { PhysicalActivitiesModule } from '../physical-activities/physical-activities.module';
import { XpModule } from '../xp/xp.module';

import { McpController } from './mcp.controller';
import { OAuthController } from './oauth.controller';
import { McpAuthService } from './mcp-auth.service';
import { McpServerFactory } from './mcp-server.factory';

/**
 * Modulo MCP: expone el connector remoto de NaviTracker para Claude.
 *
 *  - `/mcp`                  endpoint Streamable HTTP con las tools.
 *  - `/oauth/*`              Authorization Server OAuth 2.1 + PKCE + DCR.
 *  - `/.well-known/oauth-*`  discovery metadata.
 *
 * Reutiliza los servicios de dominio existentes (nutricion, hidratacion,
 * habitos, tareas, day-score) en lugar de duplicar logica.
 */
@Module({
  imports: [
    JwtModule.register({
      // El secreto real se pasa explicito en cada sign/verify de McpAuthService;
      // este es solo el default del modulo. En produccion JWT_SECRET es
      // obligatorio (validado en main.ts); el fallback es solo para dev/test.
      secret: process.env.JWT_SECRET || 'dev-only-insecure-jwt-secret',
    }),
    AuthModule,
    NutritionModule,
    HydrationModule,
    CompletionsModule,
    ActivitiesModule,
    DayScoreModule,
    TasksModule,
    SavedMealsModule,
    GoalModule,
    BriefingModule,
    AnalyzeFoodModule,
    TrelloModule,
    NotesModule,
    PhysicalActivitiesModule,
    XpModule,
  ],
  controllers: [McpController, OAuthController],
  providers: [McpAuthService, McpServerFactory, PrismaService],
})
export class McpModule {}
