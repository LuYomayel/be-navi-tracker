import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { NutritionService } from "./nutrition.service";
import { NutritionAnalysis, ApiResponse } from "../../common/types";

@Controller("nutrition")
export class NutritionController {
  constructor(private readonly nutritionService: NutritionService) {}

  @Get()
  async getAnalyses(
    @Query("date") date?: string
  ): Promise<ApiResponse<NutritionAnalysis[]>> {
    try {
      const analyses = date
        ? await this.nutritionService.getByDate(date)
        : await this.nutritionService.getAll();

      return { success: true, data: analyses };
    } catch (error) {
      console.error("Error fetching nutrition analyses:", error);
      return {
        success: false,
        error: "Failed to fetch nutrition analyses",
      };
    }
  }

  @Post()
  async create(
    @Body()
    analysisData: Omit<NutritionAnalysis, "id" | "createdAt" | "updatedAt">
  ): Promise<ApiResponse<NutritionAnalysis>> {
    try {
      const analysis = await this.nutritionService.create(analysisData);
      return { success: true, data: analysis };
    } catch (error) {
      console.error("Error creating nutrition analysis:", error);
      throw new HttpException(
        "Failed to create nutrition analysis",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Delete()
  async delete(
    @Query("id") id: string
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    try {
      if (!id) {
        throw new HttpException(
          "Analysis ID is required",
          HttpStatus.BAD_REQUEST
        );
      }

      const success = await this.nutritionService.delete(id);
      return { success, data: { deleted: success } };
    } catch (error) {
      console.error("Error deleting nutrition analysis:", error);
      throw new HttpException(
        "Failed to delete nutrition analysis",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
