import {
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { CompletionsService } from "./completions.service";
import { DailyCompletion, ApiResponse } from "../../common/types";

@Controller("completions")
export class CompletionsController {
  constructor(private readonly completionsService: CompletionsService) {}

  @Get()
  async getAll(): Promise<ApiResponse<DailyCompletion[]>> {
    try {
      const completions = await this.completionsService.getAll();
      return { success: true, data: completions };
    } catch (error) {
      console.error("Error fetching completions:", error);
      return {
        success: false,
        error: "Failed to fetch completions",
      };
    }
  }

  @Post()
  async toggle(
    @Body() toggleData: { activityId: string; date: string }
  ): Promise<ApiResponse<DailyCompletion>> {
    try {
      const { activityId, date } = toggleData;
      const completion = await this.completionsService.toggle(activityId, date);
      return { success: true, data: completion };
    } catch (error) {
      console.error("Error toggling completion:", error);
      throw new HttpException(
        "Failed to toggle completion",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
