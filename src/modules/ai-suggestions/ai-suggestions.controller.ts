import {
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { AiSuggestionsService } from "./ai-suggestions.service";
import { ApiResponse } from "../../common/types";

interface SuggestionRequest {
  message: string;
  chatHistory?: Array<{ role: string; content: string }>;
}

@Controller("ai-suggestions")
export class AiSuggestionsController {
  constructor(private readonly aiSuggestionsService: AiSuggestionsService) {}

  @Post()
  async generateSuggestion(
    @Body() request: SuggestionRequest
  ): Promise<ApiResponse<any>> {
    try {
      const { message, chatHistory = [] } = request;

      if (!message) {
        throw new HttpException("Mensaje requerido", HttpStatus.BAD_REQUEST);
      }

      const suggestion = await this.aiSuggestionsService.generateSuggestion(
        message,
        chatHistory
      );

      return {
        success: true,
        data: suggestion,
      };
    } catch (error) {
      console.error("Error generating AI suggestion:", error);
      throw new HttpException(
        "Error generando sugerencia",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get()
  async getStatus(): Promise<
    ApiResponse<{ openaiAvailable: boolean; status: string }>
  > {
    try {
      const status = await this.aiSuggestionsService.getStatus();
      return {
        success: true,
        data: status,
      };
    } catch (error) {
      console.error("Error getting AI suggestions status:", error);
      return {
        success: false,
        error: "Error getting status",
      };
    }
  }
}
