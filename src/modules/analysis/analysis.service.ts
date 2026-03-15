import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

interface ContentRecommendation {
  title: string;
  author: string;
  description: string;
  reason: string;
  category: string;
  estimatedTime: string;
  difficulty: 'Principiante' | 'Intermedio' | 'Avanzado';
  type: 'libro' | 'artículo' | 'podcast' | 'blog' | 'estudio' | 'informe';
  link?: string;
  platform?: string; // Para podcasts: "Spotify", "Apple Podcasts", etc.
  source?: string; // Para artículos: "Nature", "Harvard Business Review", etc.
  tags: string[];
}

interface ContentRequest {
  availableTime: string;
  preferredMood: string;
  contentType: string;
  topic: string;
  genre: string;
  includeUserPatterns?: boolean;
}

@Injectable()
export class AnalysisService {
  private openai: OpenAI | null = null;

  constructor() {
    // Inicializar OpenAI solo si hay API key
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  async getContentRecommendations(
    request: ContentRequest,
    userPatterns: any[] = [],
  ): Promise<ContentRecommendation[]> {
    if (!this.openai) {
      console.log('OpenAI no disponible, usando recomendaciones de fallback');
      return this.getFallbackRecommendations(request);
    }

    try {
      // Analizar patrones del usuario para contexto
      const userContext = this.analyzeUserPatterns(userPatterns);

      // Mapear tipos de contenido del frontend al backend
      const contentTypeMapping = this.mapContentType(request.contentType);

      // Generar prompt especializado según el tipo de contenido
      const prompt = this.generateAdvancedPrompt(
        request,
        userContext,
        contentTypeMapping,
      );

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `Eres un experto curador de contenido especializado en recomendar libros, artículos, podcasts, blogs, estudios científicos e informes técnicos. Tu objetivo es proporcionar recomendaciones precisas, relevantes y de alta calidad basadas en las preferencias específicas del usuario.

REGLAS IMPORTANTES:
1. SIEMPRE recomienda contenido REAL que existe
2. Proporciona links reales y verificables cuando sea posible
3. Adapta las recomendaciones al tiempo disponible del usuario
4. Considera el estado de ánimo y género solicitado
5. Incluye información de fuente/plataforma cuando corresponda
6. Varía la dificultad según el contexto
7. Proporciona tags relevantes para cada recomendación`,
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2500,
        temperature: 0.7,
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No se recibió respuesta de OpenAI');
      }

      // Intentar parsear la respuesta JSON
      let parsed;
      try {
        parsed = JSON.parse(response);
      } catch (parseError) {
        console.error('Error al parsear respuesta de OpenAI:', parseError);
        console.log('Respuesta recibida:', response);
        throw new Error('Respuesta de OpenAI no válida');
      }

      const recommendations = parsed.recommendations || [];

      // Validar y limpiar las recomendaciones
      const validatedRecommendations =
        this.validateAndCleanRecommendations(recommendations);

      console.log(
        `✅ Generadas ${validatedRecommendations.length} recomendaciones con OpenAI`,
      );
      return validatedRecommendations;
    } catch (error) {
      console.error('Error al obtener recomendaciones de contenido:', error);
      // Fallback a recomendaciones predefinidas
      return this.getFallbackRecommendations(request);
    }
  }

  private mapContentType(frontendType: string): string[] {
    const mapping: { [key: string]: string[] } = {
      Cualquiera: [
        'libro',
        'artículo',
        'podcast',
        'blog',
        'estudio',
        'informe',
      ],
      '📚 Libros': ['libro'],
      '📄 Artículos': ['artículo'],
      '🎧 Podcasts': ['podcast'],
      '📝 Blogs': ['blog'],
      '🔬 Estudios científicos': ['estudio'],
      '📊 Informes técnicos': ['informe'],
    };
    return mapping[frontendType] || ['libro', 'artículo', 'podcast', 'blog'];
  }

  private generateAdvancedPrompt(
    request: ContentRequest,
    userContext: string,
    allowedTypes: string[],
  ): string {
    const { availableTime, preferredMood, topic, genre } = request;

    const typeInstructions = this.getTypeSpecificInstructions(allowedTypes);
    const genreContext = this.getGenreContext(genre);
    const moodContext = this.getMoodContext(preferredMood);
    const timeContext = this.getTimeContext(availableTime);

    return `Necesito exactamente 4 recomendaciones de contenido para un usuario con estas características:

PERFIL DEL USUARIO:
- Tiempo disponible: ${availableTime}
- Estado de ánimo: ${preferredMood}
- Género/Tema de interés: ${genre}
- Búsqueda específica: ${topic || 'Sin búsqueda específica'}
- Contexto del usuario: ${userContext}
- Tipos de contenido permitidos: ${allowedTypes.join(', ')}

CONTEXTO ESPECÍFICO:
${genreContext}
${moodContext}
${timeContext}

INSTRUCCIONES PARA TIPOS DE CONTENIDO:
${typeInstructions}

BÚSQUEDA ESPECÍFICA:
${topic ? `El usuario busca específicamente contenido relacionado con: "${topic}". Asegúrate de que todas las recomendaciones estén relacionadas con este tema.` : 'No hay búsqueda específica, recomienda contenido variado dentro del género seleccionado.'}

Responde ÚNICAMENTE con un JSON válido en este formato exacto:
{
  "recommendations": [
    {
      "title": "Título exacto del contenido",
      "author": "Autor/Creador real",
      "description": "Descripción atractiva de 2-3 líneas",
      "reason": "Por qué es perfecto para este usuario específico",
      "category": "Categoría específica",
      "estimatedTime": "Tiempo de consumo realista",
      "difficulty": "Principiante|Intermedio|Avanzado",
      "type": "libro|artículo|podcast|blog|estudio|informe",
      "link": "URL real si existe (opcional)",
      "platform": "Plataforma específica para podcasts (opcional)",
      "source": "Fuente para artículos/estudios (opcional)",
      "tags": ["tag1", "tag2", "tag3", "tag4"]
    }
  ]
}`;
  }

  private getTypeSpecificInstructions(allowedTypes: string[]): string {
    const instructions: { [key: string]: string } = {
      libro:
        '- LIBROS: Recomienda libros reales de autores conocidos. Estima tiempo de lectura realista.',
      artículo:
        '- ARTÍCULOS: Incluye artículos de fuentes prestigiosas (Nature, Science, Harvard Business Review, MIT Technology Review, etc.). Proporciona links reales cuando sea posible.',
      podcast:
        '- PODCASTS: Recomienda episodios específicos de podcasts populares (Joe Rogan, Lex Fridman, Tim Ferriss, etc.). Incluye plataforma (Spotify, Apple Podcasts) y links cuando sea posible.',
      blog: '- BLOGS: Sugiere posts de blogs reconocidos en el área. Incluye la fuente del blog.',
      estudio:
        '- ESTUDIOS: Recomienda papers académicos reales de journals prestigiosos. Incluye DOI o link cuando sea posible.',
      informe:
        '- INFORMES: Sugiere reportes técnicos de empresas/organizaciones reconocidas (McKinsey, Deloitte, IBM, Google, etc.).',
    };

    return allowedTypes
      .map((type) => instructions[type])
      .filter(Boolean)
      .join('\n');
  }

  private getGenreContext(genre: string): string {
    const contexts: { [key: string]: string } = {
      '🤖 Inteligencia Artificial':
        'Enfócate en IA, machine learning, deep learning, AGI, y el futuro de la tecnología.',
      '🧬 Biociencia y Medicina':
        'Incluye genética, biotecnología, medicina personalizada, y avances en salud.',
      '💼 Negocios y Emprendimiento':
        'Cubre estrategia empresarial, startups, liderazgo, y casos de éxito.',
      '🧠 Psicología y Desarrollo Personal':
        'Enfócate en hábitos, productividad, mindfulness, y crecimiento personal.',
      '💻 Tecnología y Programación':
        'Incluye desarrollo de software, nuevas tecnologías, y tendencias tech.',
      '🌍 Ciencia y Naturaleza':
        'Cubre ciencias naturales, cambio climático, y descubrimientos científicos.',
      '📈 Finanzas e Inversión':
        'Incluye inversiones, mercados financieros, y educación financiera.',
      '🎨 Creatividad y Arte':
        'Enfócate en proceso creativo, arte, diseño, y expresión artística.',
      '⚖️ Filosofía y Ética':
        'Incluye filosofía práctica, ética, y reflexiones profundas sobre la vida.',
      '🏃‍♂️ Salud y Bienestar':
        'Cubre fitness, nutrición, longevidad, y optimización de la salud.',
    };
    return contexts[genre] || 'Recomienda contenido variado y de alta calidad.';
  }

  private getMoodContext(mood: string): string {
    const contexts: { [key: string]: string } = {
      '⚡ Motivacional':
        'Prioriza contenido que inspire acción, motive al cambio, y energice al usuario.',
      '🧘 Relajante':
        'Enfócate en contenido tranquilo, reflexivo, y que promueva la calma.',
      '📚 Educativo':
        'Prioriza contenido informativo, que enseñe nuevas habilidades o conocimientos.',
      '✨ Inspirador':
        'Incluye historias de éxito, biografías inspiradoras, y contenido que eleve el espíritu.',
      '🔧 Técnico':
        'Enfócate en contenido detallado, técnico, y especializado en el área de interés.',
    };
    return (
      contexts[mood] ||
      'Adapta el tono del contenido al estado de ánimo del usuario.'
    );
  }

  private getTimeContext(time: string): string {
    const contexts: { [key: string]: string } = {
      '5 min':
        'Prioriza contenido muy corto: artículos breves, posts de blog, o capítulos cortos.',
      '15 min':
        'Incluye artículos medianos, posts de blog detallados, o episodios cortos de podcast.',
      '30 min':
        'Permite artículos largos, episodios de podcast estándar, o capítulos de libro.',
      '1 hora':
        'Incluye podcasts completos, artículos extensos, o sesiones de lectura prolongadas.',
      '2+ horas':
        'Permite cualquier tipo de contenido, incluyendo libros completos y podcasts largos.',
    };
    return (
      contexts[time] ||
      'Adapta las recomendaciones al tiempo disponible del usuario.'
    );
  }

  private validateAndCleanRecommendations(
    recommendations: any[],
  ): ContentRecommendation[] {
    return recommendations
      .filter((rec) => rec && rec.title && rec.author && rec.description)
      .map((rec) => ({
        title: rec.title,
        author: rec.author,
        description: rec.description,
        reason: rec.reason || 'Recomendado especialmente para ti',
        category: rec.category || 'General',
        estimatedTime: rec.estimatedTime || '30 min',
        difficulty: ['Principiante', 'Intermedio', 'Avanzado'].includes(
          rec.difficulty,
        )
          ? rec.difficulty
          : 'Intermedio',
        type: [
          'libro',
          'artículo',
          'podcast',
          'blog',
          'estudio',
          'informe',
        ].includes(rec.type)
          ? rec.type
          : 'artículo',
        link: rec.link || undefined,
        platform: rec.platform || undefined,
        source: rec.source || undefined,
        tags: Array.isArray(rec.tags) ? rec.tags.slice(0, 6) : [],
      }))
      .slice(0, 4); // Limitar a 4 recomendaciones
  }

  private getFallbackRecommendations(
    request: ContentRequest,
  ): ContentRecommendation[] {
    const { contentType, genre, availableTime, preferredMood, topic } = request;

    // Base de recomendaciones diversas para fallback
    const fallbackRecommendations: ContentRecommendation[] = [
      {
        title: 'Hábitos Atómicos',
        author: 'James Clear',
        description:
          'Estrategias prácticas para formar buenos hábitos y romper los malos, basadas en ciencia.',
        reason:
          'Perfecto para optimizar tu sistema de hábitos con métodos probados',
        category: 'Desarrollo Personal',
        estimatedTime: '6-8 horas',
        difficulty: 'Principiante',
        type: 'libro',
        tags: ['hábitos', 'productividad', 'desarrollo personal', 'psicología'],
      },
      {
        title: 'The AI Revolution in Healthcare',
        author: 'Dr. Eric Topol',
        description:
          'Análisis profundo sobre cómo la IA está transformando la medicina moderna.',
        reason:
          'Perspectiva actualizada sobre el futuro de la medicina y la tecnología',
        category: 'Inteligencia Artificial',
        estimatedTime: '25 min',
        difficulty: 'Intermedio',
        type: 'artículo',
        source: 'Nature Medicine',
        link: 'https://www.nature.com/articles/s41591-019-0548-6',
        tags: ['IA', 'medicina', 'tecnología', 'futuro'],
      },
      {
        title: 'Lex Fridman Podcast: Elon Musk on AI',
        author: 'Lex Fridman',
        description:
          'Conversación profunda sobre el futuro de la IA, vehículos autónomos y colonización de Marte.',
        reason:
          'Insights únicos de uno de los innovadores más influyentes de nuestro tiempo',
        category: 'Tecnología',
        estimatedTime: '2+ horas',
        difficulty: 'Intermedio',
        type: 'podcast',
        platform: 'Spotify',
        link: 'https://open.spotify.com/episode/2MA2LdqQYm5Cviqz0vqD8s',
        tags: ['IA', 'innovación', 'futuro', 'tecnología'],
      },
      {
        title: 'The Science of Productivity',
        author: 'Cal Newport',
        description:
          'Estrategias basadas en investigación para maximizar tu productividad y enfoque profundo.',
        reason:
          'Métodos científicos para mejorar tu rendimiento y concentración',
        category: 'Productividad',
        estimatedTime: '12 min',
        difficulty: 'Principiante',
        type: 'blog',
        source: 'Harvard Business Review',
        link: 'https://hbr.org/2021/03/the-science-of-productivity',
        tags: ['productividad', 'enfoque', 'ciencia', 'trabajo'],
      },
    ];

    // Filtrar por tipo de contenido
    let filtered = fallbackRecommendations;
    if (contentType !== 'Cualquiera') {
      const typeMap = this.mapContentType(contentType);
      filtered = filtered.filter((rec) => typeMap.includes(rec.type));
    }

    // Filtrar por búsqueda específica
    if (topic) {
      filtered = filtered.filter(
        (rec) =>
          rec.title.toLowerCase().includes(topic.toLowerCase()) ||
          rec.description.toLowerCase().includes(topic.toLowerCase()) ||
          rec.tags.some((tag) =>
            tag.toLowerCase().includes(topic.toLowerCase()),
          ),
      );
    }

    // Si no hay resultados después del filtrado, devolver al menos una recomendación
    if (filtered.length === 0) {
      filtered = [fallbackRecommendations[0]];
    }

    return filtered.slice(0, 4);
  }

  private analyzeUserPatterns(patterns: any[]): string {
    if (!patterns || patterns.length === 0) {
      return 'Usuario nuevo sin patrones establecidos';
    }

    const analysis = patterns
      .map((pattern) => {
        if (pattern.type === 'habit_completion') {
          return `Hábito activo: ${pattern.data.habitName} (racha: ${pattern.data.streak})`;
        }
        if (pattern.type === 'nutrition_analysis') {
          return `Enfoque en nutrición (puntuación: ${pattern.data.healthScore})`;
        }
        if (pattern.type === 'sleep_tracking') {
          return `Patrones de sueño: ${pattern.data.duration}h (calidad: ${pattern.data.quality})`;
        }
        return '';
      })
      .filter(Boolean);

    return (
      analysis.join(', ') ||
      'Patrones diversos de bienestar y desarrollo personal'
    );
  }

  // Mantener métodos existentes para compatibilidad
  async getBookRecommendations(
    availableTime: string,
    preferredMood: string,
    userPatterns: any[] = [],
  ): Promise<any[]> {
    const request: ContentRequest = {
      availableTime,
      preferredMood,
      contentType: '📚 Libros',
      topic: '',
      genre: 'Cualquiera',
      includeUserPatterns: true,
    };

    return this.getContentRecommendations(request, userPatterns);
  }

  async getRecentAnalysis(days: number = 7): Promise<any[]> {
    // Datos simulados para análisis recientes
    const mockAnalyses = [
      {
        id: '1',
        type: 'habit_completion',
        data: {
          habitName: 'Ejercicio matutino',
          completed: true,
          streak: 7,
          patterns: ['morning_routine', 'consistency', 'fitness_focus'],
        },
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        metadata: {
          mood: 'energetic',
          difficulty: 'moderate',
        },
      },
      {
        id: '2',
        type: 'nutrition_analysis',
        data: {
          mealType: 'breakfast',
          healthScore: 8.7,
          patterns: ['healthy_choices', 'good_timing', 'balanced_macros'],
        },
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        metadata: {
          satisfaction: 'high',
          energy_level: 'good',
        },
      },
      {
        id: '3',
        type: 'reading_habit',
        data: {
          duration: 45,
          content_type: 'article',
          topic: 'productivity',
          patterns: ['consistent_learning', 'tech_interest'],
        },
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        metadata: {
          comprehension: 'high',
          interest_level: 'very_high',
        },
      },
    ];

    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return mockAnalyses.filter((analysis) => analysis.createdAt >= cutoffDate);
  }

  async detectPatterns(): Promise<any> {
    return {
      streaks: {
        current_longest: 7,
        habit: 'Ejercicio matutino',
      },
      trends: {
        most_consistent: 'morning_routine',
        needs_improvement: 'evening_reading',
        growing_interest: 'AI_and_technology',
      },
      recommendations: [
        'Tu rutina matutina está muy consolidada',
        'Considera explorar más contenido sobre IA y tecnología',
        'Tus hábitos nutricionales muestran excelente progreso',
      ],
      detected_issues: [],
      strengths: [
        'consistency',
        'morning_motivation',
        'healthy_choices',
        'learning_mindset',
      ],
    };
  }
}
