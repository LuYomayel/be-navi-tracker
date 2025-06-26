import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
/*
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
*/

interface FoodAnalysisResponse {
  foods: DetectedFood[];
  totalCalories: number;
  macronutrients: Macronutrients;
  confidence: number;
  mealType: MealType;
  recommendations?: string[];
}

export interface DetectedFood {
  name: string;
  quantity: string; // "1 taza", "150g", etc.
  calories: number;
  confidence: number; // 0-1
  macronutrients: Macronutrients;
  category: FoodCategory;
}

export interface Macronutrients {
  protein: number; // gramos
  carbs: number; // gramos
  fat: number; // gramos
  fiber: number; // gramos
  sugar: number; // gramos
  sodium: number; // miligramos
}

export enum FoodCategory {
  PROTEIN = 'protein',
  CARBS = 'carbs',
  VEGETABLES = 'vegetables',
  FRUITS = 'fruits',
  DAIRY = 'dairy',
  FATS = 'fats',
  BEVERAGES = 'beverages',
  PROCESSED = 'processed',
  OTHER = 'other',
}

export enum MealType {
  BREAKFAST = 'breakfast',
  LUNCH = 'lunch',
  DINNER = 'dinner',
  SNACK = 'snack',
  OTHER = 'other',
}

@Injectable()
export class AnalyzeFoodService {
  private openai: OpenAI | null = null;

  constructor() {
    // Inicializar OpenAI solo si hay API key
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  // Función helper para limpiar respuestas de OpenAI que pueden venir con markdown
  private cleanOpenAIResponse(response: string): string {
    let cleaned = response.trim();

    // Eliminar bloques de código markdown (```json ... ``` o ``` ... ```)
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    return cleaned.trim();
  }

  async analyzeImageFood(
    imageBase64: string,
    mealType?: string,
  ): Promise<FoodAnalysisResponse> {
    if (!this.openai) {
      console.log('OpenAI no disponible, usando análisis de fallback');
      return this.getMockFoodAnalysis(mealType);
    }

    try {
      // Generar prompt especializado para análisis de comida
      const prompt = this.generateFoodAnalysisPrompt(mealType);

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `Eres un nutricionista experto especializado en análisis de alimentos a través de imágenes. Tu tarea es identificar alimentos, estimar cantidades, y calcular información nutricional de manera precisa.

TIPOS DE IMÁGENES QUE PUEDES RECIBIR:
1. FOTO DE COMIDA/PLATO: Analiza los alimentos preparados y listos para comer
2. FOTO DE RECETA: Si ves texto con ingredientes y cantidades, analiza la receta completa
3. FOTO DE INGREDIENTES: Si ves ingredientes crudos/separados, analízalos individualmente

REGLAS IMPORTANTES:
1. Si es una FOTO DE RECETA (ves texto con ingredientes):
   - Lee cuidadosamente todos los ingredientes listados
   - Usa las cantidades especificadas en la receta
   - Calcula la información nutricional total de la receta
   - Considera las porciones que rinde la receta
2. Si es una FOTO DE COMIDA/PLATO:
   - Analiza cada alimento visible en la imagen
   - Estima cantidades basándote en referencias visuales (tamaño de platos, cubiertos, etc.)
   - Identifica preparaciones y métodos de cocción
3. PARA AMBOS CASOS:
   - Calcula calorías y macronutrientes usando bases de datos nutricionales estándar
   - Proporciona un nivel de confianza realista para cada estimación
   - Incluye recomendaciones nutricionales generales
   - Si no puedes identificar algo claramente, sé honesto sobre el nivel de confianza
   - Usa categorías estándar: protein, carbs, vegetables, fruits, dairy, fats, grains, beverages, processed
   - Las cantidades deben ser realistas (ej: "150g", "1 taza", "1 unidad mediana", "2 cucharadas")

IMPORTANTE: Si detectas que es una receta, menciona en las recomendaciones que es un análisis de receta completa.`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64,
                  detail: 'high',
                },
              },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0.2, // Muy conservador para análisis nutricional preciso
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No se recibió respuesta de OpenAI Vision');
      }

      // Limpiar y parsear la respuesta JSON
      const cleanedResponse = this.cleanOpenAIResponse(response);
      let parsed;
      try {
        parsed = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error(
          'Error parseando respuesta de OpenAI Vision:',
          parseError,
        );
        console.log('Respuesta original recibida:', response);
        console.log('Respuesta limpiada:', cleanedResponse);
        throw new Error('Respuesta de OpenAI Vision no válida');
      }

      // Validar y limpiar la respuesta
      const validatedAnalysis = this.validateAndCleanFoodAnalysis(
        parsed,
        mealType,
      );

      console.log('✅ Análisis de comida generado con OpenAI Vision');
      return validatedAnalysis;
    } catch (error) {
      console.error('Error analizando imagen de comida con OpenAI:', error);
      // Fallback a análisis predefinido
      return this.getMockFoodAnalysis(mealType);
    }
  }

  async analyzeManualFood(
    name: string,
    servings: number,
    calories: number,
    protein: number,
    carbs: number,
    fat: number,
    fiber: number,
    sugar: number,
    sodium: number,
    mealType: MealType,
  ): Promise<FoodAnalysisResponse> {
    if (!this.openai) {
      console.log('OpenAI no disponible, usando análisis de fallback');
      return this.getMockFoodAnalysis(mealType);
    }

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `Eres un nutricionista experto especializado en análisis de alimentos a través de imágenes. Tu tarea es identificar alimentos, estimar cantidades, y calcular información nutricional de manera precisa.
REGLAS IMPORTANTES:
1. Analiza cuidadosamente el alimento que se te proporciona.
2. Estima cantidades basándote en referencias visuales (tamaño de platos, cubiertos, etc.)
3. Calcula calorías y macronutrientes usando bases de datos nutricionales estándar
4. Proporciona un nivel de confianza realista para cada estimación.
5. Incluye recomendaciones nutricionales generales.
6. Si no puedes identificar algo claramente, sé honesto sobre el nivel de confianza.
7. Usa categorías estándar: protein, carbs, vegetables, fruits, dairy, fats, grains.
8. Las cantidades deben ser realistas (ej: "150g", "1 taza", "1 unidad mediana").
IMPORTANTE: Responde ÚNICAMENTE con un JSON válido, sin bloques de código markdown, sin explicaciones adicionales. Solo el JSON puro:
{
  "foods": [
    {
      "name": "nombre_del_alimento",
      "quantity": "cantidad_estimada (ej: 150g, 1 taza, 1 unidad)",
      "calories": número_calorías,
      "confidence": número_entre_0.1_y_1.0,
      "macronutrients": {
        "protein": gramos_proteína,
        "carbs": gramos_carbohidratos,
        "fat": gramos_grasa,
        "fiber": gramos_fibra,
        "sugar": gramos_azúcar,
        "sodium": miligramos_sodio
      },
      "category": "protein|carbs|vegetables|fruits|dairy|fats|grains"
    }
  ],
  "totalCalories": suma_total_calorías,
  "totalMacronutrients": {
    "protein": suma_total_proteína,
    "carbs": suma_total_carbohidratos,
    "fat": suma_total_grasa,
    "fiber": suma_total_fibra,
    "sugar": suma_total_azúcar,
    "sodium": suma_total_sodio
  },
  "confidence": promedio_confianza_general,
  "mealType": "${mealType || 'comida'}",
  "recommendations": [
    "recomendación_nutricional_1",
    "recomendación_nutricional_2",
    "recomendación_nutricional_3"
  ]
}

IMPORTANTE: Asegúrate de que los totales sean la suma exacta de los valores individuales.`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Receta: ${name}
                Cantidades: ${servings}
                Calorías: ${calories}
                Proteína: ${protein}
                Carbohidratos: ${carbs}
                Grasa: ${fat}
                Fibra: ${fiber}
                Azúcar: ${sugar}
                Sodio: ${sodium}`,
              },
              {
                type: 'text',
                text: `
                `,
              },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0.2, // Muy conservador para análisis nutricional preciso
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No se recibió respuesta de OpenAI Vision');
      }

      // Limpiar y parsear la respuesta JSON
      const cleanedResponse = this.cleanOpenAIResponse(response);
      let parsed;
      try {
        parsed = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error(
          'Error parseando respuesta de OpenAI Vision:',
          parseError,
        );
        console.log('Respuesta original recibida:', response);
        console.log('Respuesta limpiada:', cleanedResponse);
        throw new Error('Respuesta de OpenAI Vision no válida');
      }

      // Validar y limpiar la respuesta
      const validatedAnalysis = this.validateAndCleanFoodAnalysis(
        parsed,
        mealType,
      );

      console.log('✅ Análisis de comida generado con OpenAI Vision');
      return validatedAnalysis;
    } catch (error) {
      console.error('Error analizando imagen de comida con OpenAI:', error);
      // Fallback a análisis predefinido
      return this.getMockFoodAnalysis(mealType);
    }
  }

  // NOTA: OpenAI no puede acceder a URLs directamente
  // Este método no funcionará como está implementado
  // Para analizar recetas de links, necesitarías:
  // 1. Un web scraper que extraiga el contenido del link
  // 2. Pasar el texto extraído a OpenAI para análisis
  /*
  async analyzeRecipeFood(
    recipeLink: string,
    mealType?: string,
  ): Promise<FoodAnalysisResponse> {
    // ESTE MÉTODO NO FUNCIONA - OpenAI no puede acceder a URLs
    throw new Error('OpenAI no puede acceder directamente a URLs. Necesitas extraer el contenido del link primero.');
  }
  */

  // Alternativa: método para analizar texto de receta extraído
  async analyzeRecipeText(
    recipeText: string,
    mealType?: string,
  ): Promise<FoodAnalysisResponse> {
    if (!this.openai) {
      console.log('OpenAI no disponible, usando análisis de fallback');
      return this.getMockFoodAnalysis(mealType);
    }

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `Eres un nutricionista experto especializado en análisis de recetas. Tu tarea es analizar el texto de una receta, identificar ingredientes, estimar cantidades, y calcular información nutricional de manera precisa.

REGLAS IMPORTANTES:
1. Analiza cuidadosamente todos los ingredientes listados en la receta
2. Usa las cantidades exactas especificadas en la receta
3. Calcula calorías y macronutrientes usando bases de datos nutricionales estándar
4. Si la receta indica porciones, calcula por porción individual
5. Proporciona un nivel de confianza realista para cada estimación
6. Incluye recomendaciones nutricionales generales
7. Usa categorías estándar: protein, carbs, vegetables, fruits, dairy, fats, grains, beverages, processed
8. Las cantidades deben corresponder a lo especificado en la receta`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analiza esta receta y proporciona información nutricional detallada${mealType ? ` para ${mealType}` : ''}:

TEXTO DE LA RECETA:
${recipeText}

${this.generateFoodAnalysisPrompt(mealType)}`,
              },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0.2,
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No se recibió respuesta de OpenAI');
      }

      // Limpiar y parsear la respuesta JSON
      const cleanedResponse = this.cleanOpenAIResponse(response);
      let parsed;
      try {
        parsed = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error('Error parseando respuesta de OpenAI:', parseError);
        console.log('Respuesta original recibida:', response);
        console.log('Respuesta limpiada:', cleanedResponse);
        throw new Error('Respuesta de OpenAI no válida');
      }

      // Validar y limpiar la respuesta
      const validatedAnalysis = this.validateAndCleanFoodAnalysis(
        parsed,
        mealType,
      );

      console.log('✅ Análisis de receta generado con OpenAI');
      return validatedAnalysis;
    } catch (error) {
      console.error('Error analizando receta con OpenAI:', error);
      // Fallback a análisis predefinido
      return this.getMockFoodAnalysis(mealType);
    }
  }

  private generateFoodAnalysisPrompt(mealType?: string): string {
    const mealContext = mealType ? ` para ${mealType}` : '';

    return `Analiza esta imagen${mealContext} y proporciona información nutricional detallada.

TIPOS DE ANÁLISIS POSIBLES:
1. Si ves un PLATO DE COMIDA: Analiza los alimentos preparados y listos para comer
2. Si ves una RECETA (texto con ingredientes): Analiza todos los ingredientes listados
3. Si ves INGREDIENTES SEPARADOS: Analiza cada ingrediente individualmente

INSTRUCCIONES ESPECÍFICAS:
1. PARA PLATOS DE COMIDA:
   - Identifica cada alimento visible
   - Estima cantidades usando referencias visuales (platos, cubiertos, etc.)
   - Considera métodos de preparación (frito, al vapor, etc.)

2. PARA RECETAS:
   - Lee cuidadosamente todos los ingredientes listados
   - Usa las cantidades exactas especificadas
   - Si menciona porciones, calcula por porción individual
   - Indica en recomendaciones que es "Análisis de receta completa"

3. PARA AMBOS CASOS:
   - Calcula calorías y macronutrientes para cada elemento
   - Proporciona nivel de confianza realista
   - Categoriza apropiadamente cada alimento
   - Incluye recomendaciones nutricionales

IMPORTANTE: Responde ÚNICAMENTE con un JSON válido, sin bloques de código markdown, sin explicaciones adicionales. Solo el JSON puro:
{
  "foods": [
    {
      "name": "nombre_del_alimento",
      "quantity": "cantidad_estimada (ej: 150g, 1 taza, 1 unidad mediana)",
      "calories": número_calorías,
      "confidence": número_entre_0.1_y_1.0,
      "macronutrients": {
        "protein": gramos_proteína,
        "carbs": gramos_carbohidratos,
        "fat": gramos_grasa,
        "fiber": gramos_fibra,
        "sugar": gramos_azúcar,
        "sodium": miligramos_sodio
      },
      "category": "protein|carbs|vegetables|fruits|dairy|fats|grains|beverages|processed|other"
    }
  ],
  "totalCalories": suma_total_calorías,
  "macronutrients": {
    "protein": suma_total_proteína,
    "carbs": suma_total_carbohidratos,
    "fat": suma_total_grasa,
    "fiber": suma_total_fibra,
    "sugar": suma_total_azúcar,
    "sodium": suma_total_sodio
  },
  "confidence": promedio_confianza_general,
  "mealType": "${mealType || 'other'}",
  "recommendations": [
    "recomendación_nutricional_1",
    "recomendación_nutricional_2",
    "recomendación_nutricional_3"
  ]
}

IMPORTANTE: 
- Asegúrate de que los totales sean la suma exacta de los valores individuales
- Si es una receta, menciona "Análisis de receta completa" en las recomendaciones
- Usa todas las categorías disponibles: protein, carbs, vegetables, fruits, dairy, fats, grains, beverages, processed, other`;
  }

  private validateAndCleanFoodAnalysis(
    analysis: any,
    mealType?: string,
  ): FoodAnalysisResponse {
    // Validar que existe el array de foods
    if (!analysis.foods || !Array.isArray(analysis.foods)) {
      console.warn(
        'Respuesta de OpenAI no tiene foods válidos, usando fallback',
      );
      return this.getMockFoodAnalysis(mealType);
    }

    // Limpiar y validar cada alimento
    const validatedFoods = analysis.foods.map((food: any) => ({
      name: food.name || 'Alimento no identificado',
      quantity: food.quantity || 'Cantidad no especificada',
      calories: this.clampNumber(food.calories, 0, 2000, 100),
      confidence: this.clampNumber(food.confidence, 0.1, 1.0, 0.5),
      macronutrients: {
        protein: this.clampNumber(food.macronutrients?.protein, 0, 100, 5),
        carbs: this.clampNumber(food.macronutrients?.carbs, 0, 200, 15),
        fat: this.clampNumber(food.macronutrients?.fat, 0, 100, 5),
        fiber: this.clampNumber(food.macronutrients?.fiber, 0, 50, 2),
        sugar: this.clampNumber(food.macronutrients?.sugar, 0, 100, 5),
        sodium: this.clampNumber(food.macronutrients?.sodium, 0, 5000, 200),
      },
      category: this.validateCategory(food.category),
    }));

    // Calcular totales
    const totalCalories = validatedFoods.reduce(
      (sum, food) => sum + food.calories,
      0,
    );
    const totalMacronutrients = validatedFoods.reduce(
      (totals, food) => ({
        protein: totals.protein + food.macronutrients.protein,
        carbs: totals.carbs + food.macronutrients.carbs,
        fat: totals.fat + food.macronutrients.fat,
        fiber: totals.fiber + food.macronutrients.fiber,
        sugar: totals.sugar + food.macronutrients.sugar,
        sodium: totals.sodium + food.macronutrients.sodium,
      }),
      { protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 },
    );

    const averageConfidence =
      validatedFoods.reduce((sum, food) => sum + food.confidence, 0) /
      validatedFoods.length;

    return {
      foods: validatedFoods,
      totalCalories,
      macronutrients: totalMacronutrients,
      confidence: this.clampNumber(averageConfidence, 0.1, 1.0, 0.5),
      mealType: mealType as MealType,
      recommendations: Array.isArray(analysis.recommendations)
        ? analysis.recommendations.slice(0, 5) // Máximo 5 recomendaciones
        : [
            'Mantén un balance de macronutrientes',
            'Incluye más vegetales si es posible',
            'Hidrátate adecuadamente con las comidas',
          ],
    };
  }

  private clampNumber(
    value: any,
    min: number,
    max: number,
    defaultValue: number,
  ): number {
    if (typeof value !== 'number' || isNaN(value)) {
      return defaultValue;
    }
    return Math.max(min, Math.min(max, value));
  }

  private validateCategory(category: any): FoodCategory {
    const validCategories = [
      FoodCategory.PROTEIN,
      FoodCategory.CARBS,
      FoodCategory.VEGETABLES,
      FoodCategory.FRUITS,
      FoodCategory.DAIRY,
      FoodCategory.FATS,
      FoodCategory.BEVERAGES,
      FoodCategory.PROCESSED,
      FoodCategory.OTHER,
    ];

    // Convertir string a enum value si es válido
    const categoryValue = Object.values(FoodCategory).find(
      (val) => val === category,
    );

    if (categoryValue && validCategories.includes(categoryValue)) {
      return categoryValue;
    }
    return FoodCategory.OTHER; // Categoría por defecto
  }

  // Función fallback para cuando no hay OpenAI disponible
  getMockFoodAnalysis(mealType?: string): FoodAnalysisResponse {
    return {
      foods: [
        {
          name: 'Pollo a la plancha',
          quantity: '150g',
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
          category: FoodCategory.PROTEIN,
        },
        {
          name: 'Arroz integral',
          quantity: '1 taza',
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
          category: FoodCategory.CARBS,
        },
        {
          name: 'Brócoli al vapor',
          quantity: '100g',
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
          category: FoodCategory.VEGETABLES,
        },
      ],
      totalCalories: 481,
      macronutrients: {
        protein: 51.3,
        carbs: 52.0,
        fat: 7.2,
        fiber: 6.1,
        sugar: 2.2,
        sodium: 117,
      },
      confidence: 0.88,
      mealType: mealType as MealType,
      recommendations: [
        'Excelente balance de macronutrientes',
        'Buena fuente de proteína magra',
        'Considera agregar grasas saludables como aguacate',
      ],
    };
  }
}
