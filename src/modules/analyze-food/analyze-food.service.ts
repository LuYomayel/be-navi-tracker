import { Injectable } from "@nestjs/common";

interface FoodAnalysisRequest {
  image: string; // Base64 encoded image
  mealType?: string;
}

interface FoodAnalysisResponse {
  foods: Array<{
    name: string;
    quantity: string;
    calories: number;
    confidence: number;
    macronutrients: {
      protein: number;
      carbs: number;
      fat: number;
      fiber: number;
      sugar: number;
      sodium: number;
    };
    category: string;
  }>;
  totalCalories: number;
  totalMacronutrients: {
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    sugar: number;
    sodium: number;
  };
  confidence: number;
  mealType: string;
  recommendations?: string[];
}

@Injectable()
export class AnalyzeFoodService {
  // Función fallback para cuando no hay OpenAI disponible
  getMockFoodAnalysis(mealType?: string): FoodAnalysisResponse {
    return {
      foods: [
        {
          name: "Pollo a la plancha",
          quantity: "150g",
          calories: 231,
          confidence: 0.85,
          macronutrients: {
            protein: 43.5,
            carbs: 0,
            fat: 5.0,
            fiber: 0,
            sugar: 0,
            sodium: 74,
          },
          category: "protein",
        },
        {
          name: "Arroz integral",
          quantity: "1 taza",
          calories: 216,
          confidence: 0.88,
          macronutrients: {
            protein: 5.0,
            carbs: 45.0,
            fat: 1.8,
            fiber: 3.5,
            sugar: 0.7,
            sodium: 10,
          },
          category: "carbs",
        },
        {
          name: "Brócoli al vapor",
          quantity: "100g",
          calories: 34,
          confidence: 0.92,
          macronutrients: {
            protein: 2.8,
            carbs: 7.0,
            fat: 0.4,
            fiber: 2.6,
            sugar: 1.5,
            sodium: 33,
          },
          category: "vegetables",
        },
      ],
      totalCalories: 481,
      totalMacronutrients: {
        protein: 51.3,
        carbs: 52.0,
        fat: 7.2,
        fiber: 6.1,
        sugar: 2.2,
        sodium: 117,
      },
      confidence: 0.88,
      mealType: mealType || "comida",
      recommendations: [
        "Excelente balance de macronutrientes",
        "Buena fuente de proteína magra",
        "Considera agregar grasas saludables como aguacate",
      ],
    };
  }

  async analyzeFood(
    imageBase64: string,
    mealType?: string
  ): Promise<FoodAnalysisResponse> {
    // TODO: Implementar integración con OpenAI cuando se configure la API key
    // Por ahora, devolvemos datos mock
    return this.getMockFoodAnalysis(mealType);
  }
}
