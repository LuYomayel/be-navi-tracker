import { Module } from "@nestjs/common";
import { CompletionsController } from "./completions.controller";
import { CompletionsService } from "./completions.service";
import { PrismaService } from "../../config/prisma.service";

@Module({
  controllers: [CompletionsController],
  providers: [CompletionsService, PrismaService],
})
export class CompletionsModule {}
