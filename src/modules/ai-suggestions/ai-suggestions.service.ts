import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

interface AISuggestionResponse {
  message: string;
  suggestions?: string[];
  type?: 'general' | 'reading' | 'nutrition' | 'habits';
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
  private openai: OpenAI | null = null;

  constructor() {
    // Inicializar OpenAI solo si hay API key
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  // Respuestas predefinidas como fallback
  private readonly SMART_RESPONSES: Record<string, AISuggestionResponse> = {
    rutina: {
      message:
        '¡Excelente pregunta sobre rutinas! Basándome en los patrones de usuarios exitosos, aquí tienes algunas sugerencias:',
      suggestions: [
        'Comienza con 3-4 hábitos máximo para evitar saturarte',
        'Vincula nuevos hábitos con actividades que ya haces (hábito stacking)',
        'Usa la regla de los 2 minutos: cualquier hábito nuevo debe tomar menos de 2 min al principio',
        'Celebra pequeños logros para mantener la motivación',
        'Ten un plan de contingencia para días difíciles',
      ],
      type: 'habits',
    },
    motivacion: {
      message:
        'La motivación es como una chispa, pero los hábitos son el combustible. Te ayudo a mantener ambos:',
      suggestions: [
        "Recuerda tu 'por qué' profundo - escríbelo y léelo cuando necesites impulso",
        'Usa el poder de las rachas - no rompas la cadena',
        'Encuentra un compañero de accountability',
        'Recompénsate por mantener la consistencia',
        'Haz los hábitos más fáciles cuando tengas poca energía',
      ],
      type: 'habits',
    },
    lectura: {
      message:
        '¡Fantástico que quieras mejorar tu hábito de lectura! Aquí tienes estrategias probadas:',
      suggestions: [
        'Lee al menos 1 página cada día - la consistencia es más importante que la cantidad',
        'Ten siempre un libro físico, uno digital y uno de audio para diferentes momentos',
        'Crea un ambiente de lectura sin distracciones',
        'Únete a un club de lectura o comparte recomendaciones con amigos',
        'Alterna entre ficción y no ficción según tu estado de ánimo',
      ],
      type: 'reading',
    },
    nutricion: {
      message:
        '¡Excelente decisión enfocarte en tu alimentación! La nutrición es la base de todo:',
      suggestions: [
        'Sigue la regla del plato: 1/2 vegetales, 1/4 proteína, 1/4 carbohidratos complejos',
        'Bebe un vaso de agua antes de cada comida',
        'Planifica tus comidas el domingo para toda la semana',
        'Ten snacks saludables siempre disponibles',
        'Come despacio y mastica bien - la digestión empieza en la boca',
      ],
      type: 'nutrition',
    },
    default: {
      message:
        '¡Hola! Soy tu asistente de hábitos inteligente. Puedo ayudarte con:',
      suggestions: [
        'Crear rutinas efectivas y sostenibles',
        'Mantener la motivación a largo plazo',
        'Sugerencias de lectura personalizadas',
        'Análisis nutricional de tus comidas',
        'Estrategias para mejorar tu bienestar general',
      ],
      type: 'general',
    },
  };

  private async generateWithOpenAI(
    message: string,
    chatHistory: Array<{ role: string; content: string }> = [],
  ): Promise<AISuggestionResponse> {
    if (!this.openai) {
      throw new Error('OpenAI no está configurado');
    }

    // 🎯 PASO 1: Detectar si es una solicitud para agregar hábito
    const isHabitRequest = await this.detectHabitCreationIntent(message);

    if (isHabitRequest) {
      // 🚀 PASO 2: Extraer datos del hábito con OpenAI
      return await this.extractHabitFromMessage(message);
    }

    // 🗣️ PASO 3: Si no es para agregar hábito, respuesta de chat normal
    return await this.generateChatResponse(message, chatHistory);
  }

  private async detectHabitCreationIntent(message: string): Promise<boolean> {
    const intentPrompt = `Analiza este mensaje y determina si el usuario quiere AGREGAR/CREAR un nuevo hábito a su tracker.

Mensaje: "${message}"

Responde SOLO con "SI" o "NO".

Ejemplos de SI:
- "Agregame ejercicio a las 7am"
- "Quiero añadir lectura por las noches"
- "Crear hábito de meditar 10 minutos"
- "Agrega elongamiento todos los días"

Ejemplos de NO:
- "¿Cómo puedo mantener la motivación?"
- "Dame consejos para hacer ejercicio"
- "¿Qué libro me recomiendas?"`;

    try {
      const completion = await this.openai!.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: intentPrompt }],
        max_tokens: 10,
        temperature: 0.1,
      });

      const response = completion.choices[0]?.message?.content
        ?.trim()
        .toUpperCase();
      return response === 'SI';
    } catch (error) {
      console.error('Error detectando intención:', error);
      // Fallback: detectar palabras clave
      const keywords = [
        'agreg',
        'añad',
        'crear',
        'nuevo hábito',
        'quiero hacer',
        'todos los días',
      ];
      return keywords.some((keyword) =>
        message.toLowerCase().includes(keyword),
      );
    }
  }

  private async extractHabitFromMessage(
    message: string,
  ): Promise<AISuggestionResponse> {
    const extractionPrompt = `Extrae los datos del hábito de este mensaje y responde en formato JSON válido:

Mensaje: "${message}"

Formato de respuesta (JSON válido):
{
  "message": "¡Perfecto! He detectado que quieres agregar el hábito [NOMBRE]. ¿Te gustaría que lo agregue a tu tracker?",
  "type": "habits",
  "tableDetected": false,
  "activitiesDetected": true,
  "extractedActivities": [
    {
      "name": "Nombre del hábito",
      "time": "HH:MM AM/PM o vacío si no especifica",
      "days": [true, true, true, true, true, true, true],
      "category": "fitness/bienestar/desarrollo/otros"
    }
  ],
  "suggestions": [
    "El hábito se agregará con los horarios que especificaste",
    "Puedes modificar días y horarios después",
    "Te enviaremos recordatorios para mantener la constancia"
  ]
}

Reglas:
- Si dice "todos los días" → days: [true, true, true, true, true, true, true]
- Si no especifica días → days: [true, true, true, true, true, false, false] (lunes a viernes)
- Si no especifica hora → time: ""
- Categorías: fitness, bienestar, desarrollo, nutricion, otros
- El message debe ser motivacional y confirmar que detectaste el hábito`;

    try {
      const completion = await this.openai!.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: extractionPrompt }],
        max_tokens: 500,
        temperature: 0.3,
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) throw new Error('No se recibió respuesta');

      // Limpiar respuesta para obtener solo el JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No se encontró JSON válido');

      const extractedData = JSON.parse(jsonMatch[0]);
      return extractedData;
    } catch (error) {
      console.error('Error extrayendo hábito:', error);

      // Fallback: extracción manual básica
      return {
        message: `¡Perfecto! He detectado que quieres agregar un nuevo hábito. ¿Te gustaría que lo agregue a tu tracker?`,
        type: 'habits',
        tableDetected: false,
        activitiesDetected: true,
        extractedActivities: [
          {
            name: this.extractHabitName(message),
            time: this.extractTime(message),
            days: message.toLowerCase().includes('todos los días')
              ? [true, true, true, true, true, true, true]
              : [true, true, true, true, true, false, false],
            category: this.detectCategory(message),
          },
        ],
        suggestions: [
          'El hábito se agregará con los datos que especificaste',
          'Puedes modificar horarios y días después',
          'Te ayudaremos a mantener la constancia',
        ],
      };
    }
  }

  private async generateChatResponse(
    message: string,
    chatHistory: Array<{ role: string; content: string }> = [],
  ): Promise<AISuggestionResponse> {
    // Construir el contexto del sistema para chat general
    const systemPrompt = `Eres un asistente experto en hábitos y bienestar personal llamado NaviTracker AI. 

Características de tus respuestas:
- Siempre responde en español
- Sé empático y motivacional
- Proporciona consejos prácticos y accionables
- Incluye 3-5 sugerencias específicas cuando sea apropiado
- NO eres para agregar hábitos, solo para dar consejos y motivación

El usuario NO está pidiendo agregar un hábito, solo quiere consejos o información.`;

    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...chatHistory.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
        { role: 'user', content: message },
      ];

      const completion = await this.openai!.chat.completions.create({
        model: 'gpt-4o',
        messages: messages,
        max_tokens: 800,
        temperature: 0.7,
      });

      const aiResponse = completion.choices[0]?.message?.content;

      if (!aiResponse) {
        throw new Error('No se recibió respuesta de OpenAI');
      }

      return {
        message: aiResponse,
        type: this.detectMessageType(message),
        suggestions: this.generateQuickSuggestions(message),
      };
    } catch (error) {
      console.error('Error generando respuesta de chat:', error);
      return this.findBestResponse(message);
    }
  }

  // Métodos auxiliares para extracción manual
  private extractHabitName(message: string): string {
    const lowerMessage = message.toLowerCase();

    // Buscar patrones comunes
    const patterns = [
      /agreg[ar]*\s+([^a]+?)(?:\s+a\s+las|\s+todos|\s+por)/i,
      /añad[ir]*\s+([^a]+?)(?:\s+a\s+las|\s+todos|\s+por)/i,
      /crear?\s+(?:hábito\s+de\s+)?([^a]+?)(?:\s+a\s+las|\s+todos|\s+por)/i,
      /quiero\s+(?:hacer\s+)?([^a]+?)(?:\s+a\s+las|\s+todos|\s+por)/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    // Fallback: palabras después de "agregar", "añadir", etc.
    const words = lowerMessage.split(' ');
    const actionWords = ['agregar', 'añadir', 'crear', 'hacer'];

    for (let i = 0; i < words.length; i++) {
      if (actionWords.some((action) => words[i].includes(action))) {
        const nextWords = words.slice(i + 1, i + 3).join(' ');
        if (nextWords) return nextWords;
      }
    }

    return 'Nuevo hábito';
  }

  private extractTime(message: string): string {
    // Buscar patrones de tiempo
    const timePatterns = [
      /(\d{1,2}:\d{2}\s*(?:am|pm))/i,
      /(\d{1,2}\s*(?:am|pm))/i,
      /a\s+las\s+(\d{1,2}(?::\d{2})?)/i,
      /(\d{1,2}(?::\d{2})?\s*(?:de\s+la\s+)?(?:mañana|tarde|noche))/i,
    ];

    for (const pattern of timePatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return '';
  }

  private detectCategory(message: string): string {
    const lowerMessage = message.toLowerCase();

    if (
      lowerMessage.includes('ejercicio') ||
      lowerMessage.includes('gym') ||
      lowerMessage.includes('correr') ||
      lowerMessage.includes('elongar') ||
      lowerMessage.includes('estirar')
    ) {
      return 'fitness';
    }

    if (
      lowerMessage.includes('meditar') ||
      lowerMessage.includes('relajar') ||
      lowerMessage.includes('respirar') ||
      lowerMessage.includes('mindfulness')
    ) {
      return 'bienestar';
    }

    if (
      lowerMessage.includes('leer') ||
      lowerMessage.includes('estudiar') ||
      lowerMessage.includes('aprender') ||
      lowerMessage.includes('curso')
    ) {
      return 'desarrollo';
    }

    if (
      lowerMessage.includes('comer') ||
      lowerMessage.includes('agua') ||
      lowerMessage.includes('vitamina') ||
      lowerMessage.includes('dieta')
    ) {
      return 'nutricion';
    }

    return 'otros';
  }

  private detectMessageType(
    message: string,
  ): 'general' | 'reading' | 'nutrition' | 'habits' {
    const lowercaseMessage = message.toLowerCase();

    if (
      lowercaseMessage.includes('leer') ||
      lowercaseMessage.includes('libro') ||
      lowercaseMessage.includes('lectura')
    ) {
      return 'reading';
    }
    if (
      lowercaseMessage.includes('comida') ||
      lowercaseMessage.includes('nutrición') ||
      lowercaseMessage.includes('dieta')
    ) {
      return 'nutrition';
    }
    if (
      lowercaseMessage.includes('hábito') ||
      lowercaseMessage.includes('rutina') ||
      lowercaseMessage.includes('ejercicio')
    ) {
      return 'habits';
    }

    return 'general';
  }

  private generateQuickSuggestions(message: string): string[] {
    const type = this.detectMessageType(message);
    const responses = this.SMART_RESPONSES;

    switch (type) {
      case 'reading':
        return responses.lectura.suggestions || [];
      case 'nutrition':
        return responses.nutricion.suggestions || [];
      case 'habits':
        return responses.rutina.suggestions || [];
      default:
        return responses.default.suggestions || [];
    }
  }

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

  private parseHabitTable(text: string): Array<{
    name: string;
    time?: string;
    days: boolean[];
    category?: string;
  }> {
    const lines = text.split('\n');
    const activities: Array<{
      name: string;
      time?: string;
      days: boolean[];
      category?: string;
    }> = [];

    for (const line of lines) {
      if (line.includes('|')) {
        const parts = line
          .split('|')
          .map((part) => part.trim())
          .filter((part) => part);
        if (parts.length >= 2) {
          activities.push({
            name: parts[0] || `Actividad ${activities.length + 1}`,
            time: parts[2] || undefined,
            days: [true, true, true, true, true, false, false], // Default: L-V
            category: parts[3] || 'general',
          });
        }
      }
    }

    return activities;
  }

  async generateSuggestion(
    message: string,
    chatHistory: Array<{ role: string; content: string }> = [],
  ): Promise<AISuggestionResponse> {
    // 🚀 Usar OpenAI si está disponible, sino fallback
    if (this.openai && process.env.OPENAI_API_KEY) {
      console.log('🤖 Usando OpenAI para generar respuesta...');
      return await this.generateWithOpenAI(message, chatHistory);
    } else {
      console.log('⚠️ OpenAI no configurado, usando respuestas predefinidas');
      // Detectar si hay una tabla de hábitos
      if (this.containsHabitTable(message)) {
        const extractedActivities = this.parseHabitTable(message);
        return {
          message: `¡Genial! He detectado ${extractedActivities.length} actividades en tu mensaje. ¿Te gustaría que las agregue a tu tracker?`,
          suggestions: [
            'Todas las actividades se agregarán con horarios sugeridos',
            'Puedes modificar días y horarios después',
            'Se configurarán notificaciones automáticas',
          ],
          type: 'habits',
          tableDetected: true,
          activitiesDetected: true,
          extractedActivities,
        };
      }

      // Usar respuesta inteligente basada en el contenido
      return this.findBestResponse(message);
    }
  }

  async getStatus(): Promise<{ openaiAvailable: boolean; status: string }> {
    return {
      openaiAvailable: !!process.env.OPENAI_API_KEY && !!this.openai,
      status: this.openai
        ? 'Servicio de IA con OpenAI disponible'
        : 'Servicio de IA con respuestas predefinidas (configura OPENAI_API_KEY para OpenAI real)',
    };
  }
}
