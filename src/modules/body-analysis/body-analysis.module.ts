import { Module } from "@nestjs/common";
import { BodyAnalysisController } from "./body-analysis.controller";
import { BodyAnalysisService } from "./body-analysis.service";
import { PrismaService } from "../../config/prisma.service";
import { AICostModule } from "../ai-cost/ai-cost.module";

@Module({
  imports: [AICostModule],
  controllers: [BodyAnalysisController],
  providers: [BodyAnalysisService, PrismaService],
})
export class BodyAnalysisModule {}
