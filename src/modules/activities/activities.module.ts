import { Module } from "@nestjs/common";
import { ActivitiesController } from "./activities.controller";
import { ActivitiesService } from "./activities.service";
import { PrismaService } from "../../config/prisma.service";

@Module({
  controllers: [ActivitiesController],
  providers: [ActivitiesService, PrismaService],
})
export class ActivitiesModule {}
