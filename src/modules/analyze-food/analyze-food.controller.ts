import {
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { AnalyzeFoodService } from "./analyze-food.service";
import { ApiResponse } from "../../common/types";

interface FoodAnalysisRequest {
  image: string;
  mealType?: string;
}

@Controller("analyze-food")
export class AnalyzeFoodController {
  constructor(private readonly analyzeFoodService: AnalyzeFoodService) {}

  @Post()
  async analyzeFood(
    @Body() request: FoodAnalysisRequest
  ): Promise<ApiResponse<any>> {
    try {
      const { image, mealType } = request;

      if (!image) {
        throw new HttpException("Imagen requerida", HttpStatus.BAD_REQUEST);
      }

      const analysis = await this.analyzeFoodService.analyzeFood(
        image,
        mealType
      );

      return {
        success: true,
        data: analysis,
      };
    } catch (error) {
      console.error("Error analyzing food:", error);
      throw new HttpException(
        "Error analizando la comida",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get()
  async getStatus(): Promise<
    ApiResponse<{ status: string; openaiAvailable: boolean }>
  > {
    return {
      success: true,
      data: {
        status: "Servicio de análisis de comida disponible",
        openaiAvailable: !!process.env.OPENAI_API_KEY,
      },
    };
  }
}
