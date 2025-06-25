import { Module } from "@nestjs/common";
import { AiSuggestionsController } from "./ai-suggestions.controller";
import { AiSuggestionsService } from "./ai-suggestions.service";
import { PrismaService } from "../../config/prisma.service";

@Module({
  controllers: [AiSuggestionsController],
  providers: [AiSuggestionsService, PrismaService],
})
export class AiSuggestionsModule {}
