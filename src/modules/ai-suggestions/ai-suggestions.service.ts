import { Injectable } from "@nestjs/common";

interface AISuggestionResponse {
  message: string;
  suggestions?: string[];
  type?: "general" | "reading" | "nutrition" | "habits";
  activitiesDetected?: boolean;
  tableDetected?: boolean;
  extractedActivities?: Array<{
    name: string;
    frequency?: string;
    time?: string;
    category?: string;
    days: boolean[];
  }>;
}

@Injectable()
export class AiSuggestionsService {
  // Respuestas predefinidas inteligentes para diferentes tipos de consultas
  private readonly SMART_RESPONSES: Record<string, AISuggestionResponse> = {
    rutina: {
      message:
        "¡Excelente pregunta sobre rutinas! Basándome en los patrones de usuarios exitosos, aquí tienes algunas sugerencias:",
      suggestions: [
        "Comienza con 3-4 hábitos máximo para evitar saturarte",
        "Vincula nuevos hábitos con actividades que ya haces (hábito stacking)",
        "Usa la regla de los 2 minutos: cualquier hábito nuevo debe tomar menos de 2 min al principio",
        "Celebra pequeños logros para mantener la motivación",
        "Ten un plan de contingencia para días difíciles",
      ],
      type: "habits",
    },
    motivacion: {
      message:
        "La motivación es como una chispa, pero los hábitos son el combustible. Te ayudo a mantener ambos:",
      suggestions: [
        "Recuerda tu 'por qué' profundo - escríbelo y léelo cuando necesites impulso",
        "Usa el poder de las rachas - no rompas la cadena",
        "Encuentra un compañero de accountability",
        "Recompénsate por mantener la consistencia",
        "Haz los hábitos más fáciles cuando tengas poca energía",
      ],
      type: "habits",
    },
    lectura: {
      message:
        "¡Fantástico que quieras mejorar tu hábito de lectura! Aquí tienes estrategias probadas:",
      suggestions: [
        "Lee al menos 1 página cada día - la consistencia es más importante que la cantidad",
        "Ten siempre un libro físico, uno digital y uno de audio para diferentes momentos",
        "Crea un ambiente de lectura sin distracciones",
        "Únete a un club de lectura o comparte recomendaciones con amigos",
        "Alterna entre ficción y no ficción según tu estado de ánimo",
      ],
      type: "reading",
    },
    nutricion: {
      message:
        "¡Excelente decisión enfocarte en tu alimentación! La nutrición es la base de todo:",
      suggestions: [
        "Sigue la regla del plato: 1/2 vegetales, 1/4 proteína, 1/4 carbohidratos complejos",
        "Bebe un vaso de agua antes de cada comida",
        "Planifica tus comidas el domingo para toda la semana",
        "Ten snacks saludables siempre disponibles",
        "Come despacio y mastica bien - la digestión empieza en la boca",
      ],
      type: "nutrition",
    },
    default: {
      message:
        "¡Hola! Soy tu asistente de hábitos inteligente. Puedo ayudarte con:",
      suggestions: [
        "Crear rutinas efectivas y sostenibles",
        "Mantener la motivación a largo plazo",
        "Sugerencias de lectura personalizadas",
        "Análisis nutricional de tus comidas",
        "Estrategias para mejorar tu bienestar general",
      ],
      type: "general",
    },
  };

  private findBestResponse(query: string): AISuggestionResponse {
    const lowercaseQuery = query.toLowerCase();

    for (const [key, response] of Object.entries(this.SMART_RESPONSES)) {
      if (lowercaseQuery.includes(key)) {
        return response;
      }
    }

    return this.SMART_RESPONSES.default;
  }

  private containsHabitTable(message: string): boolean {
    const tablePatterns = [
      /\|.*\|.*\|/g,
      /actividad.*frecuencia.*tiempo/i,
      /hábito.*días.*horario/i,
    ];

    return tablePatterns.some((pattern) => pattern.test(message));
  }

  private parseHabitTable(
    text: string
  ): Array<{
    name: string;
    time?: string;
    days: boolean[];
    category?: string;
  }> {
    const lines = text.split("\n");
    const activities: Array<{
      name: string;
      time?: string;
      days: boolean[];
      category?: string;
    }> = [];

    for (const line of lines) {
      if (line.includes("|")) {
        const parts = line
          .split("|")
          .map((part) => part.trim())
          .filter((part) => part);
        if (parts.length >= 2) {
          activities.push({
            name: parts[0] || `Actividad ${activities.length + 1}`,
            time: parts[2] || undefined,
            days: [true, true, true, true, true, false, false], // Default: L-V
            category: parts[3] || "general",
          });
        }
      }
    }

    return activities;
  }

  async generateSuggestion(
    message: string,
    chatHistory: Array<{ role: string; content: string }> = []
  ): Promise<AISuggestionResponse> {
    // TODO: Implementar integración con OpenAI cuando se configure la API key

    // Detectar si hay una tabla de hábitos
    if (this.containsHabitTable(message)) {
      const extractedActivities = this.parseHabitTable(message);
      return {
        message: `¡Genial! He detectado ${extractedActivities.length} actividades en tu mensaje. ¿Te gustaría que las agregue a tu tracker?`,
        suggestions: [
          "Todas las actividades se agregarán con horarios sugeridos",
          "Puedes modificar días y horarios después",
          "Se configurarán notificaciones automáticas",
        ],
        type: "habits",
        tableDetected: true,
        activitiesDetected: true,
        extractedActivities,
      };
    }

    // Usar respuesta inteligente basada en el contenido
    return this.findBestResponse(message);
  }

  async getStatus(): Promise<{ openaiAvailable: boolean; status: string }> {
    return {
      openaiAvailable: !!process.env.OPENAI_API_KEY,
      status: "Servicio de sugerencias IA disponible",
    };
  }
}
