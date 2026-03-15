import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
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
  platform?: string;
  source?: string;
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

  constructor(private prisma: PrismaService) {
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
      return this.getFallbackRecommendations(request);
    }

    try {
      const userContext = this.analyzeUserPatterns(userPatterns);
      const contentTypeMapping = this.mapContentType(request.contentType);
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

      let parsed;
      try {
        parsed = JSON.parse(response);
      } catch {
        console.error('Error al parsear respuesta de OpenAI');
        throw new Error('Respuesta de OpenAI no válida');
      }

      const recommendations = parsed.recommendations || [];
      return this.validateAndCleanRecommendations(recommendations);
    } catch (error) {
      console.error('Error al obtener recomendaciones de contenido:', error);
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
      .slice(0, 4);
  }

  private getFallbackRecommendations(
    request: ContentRequest,
  ): ContentRecommendation[] {
    const { contentType, topic } = request;

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

    let filtered = fallbackRecommendations;
    if (contentType !== 'Cualquiera') {
      const typeMap = this.mapContentType(contentType);
      filtered = filtered.filter((rec) => typeMap.includes(rec.type));
    }

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
          return `Hábito activo: ${pattern.habitName} (racha: ${pattern.streak} días)`;
        }
        if (pattern.type === 'nutrition') {
          return `Registros nutricionales: ${pattern.count} comidas (promedio ${pattern.avgCalories} kcal)`;
        }
        if (pattern.type === 'physical_activity') {
          return `Actividad física: ${pattern.count} sesiones (${pattern.avgMinutes} min promedio)`;
        }
        if (pattern.type === 'mood') {
          return `Estado anímico promedio: ${pattern.avgMood}/5`;
        }
        return '';
      })
      .filter(Boolean);

    return (
      analysis.join(', ') ||
      'Patrones diversos de bienestar y desarrollo personal'
    );
  }

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

  /**
   * Returns real recent analysis data from the database:
   * - Habit completions with streaks
   * - Nutrition logs summary
   * - Physical activity summary
   * - Mood from notes
   */
  async getRecentAnalysis(userId: string, days: number = 7): Promise<any[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    const results: any[] = [];

    try {
      // 1. Habit completions with streak info
      const completions = await this.prisma.dailyCompletion.findMany({
        where: {
          activity: { userId },
          date: { gte: cutoffDateStr },
          completed: true,
        },
        include: {
          activity: { select: { name: true, category: true } },
        },
        orderBy: { date: 'desc' },
      });

      // Group by activity and count streaks
      const habitMap = new Map<string, { name: string; count: number; category: string; dates: string[] }>();
      for (const c of completions) {
        const existing = habitMap.get(c.activityId);
        if (existing) {
          existing.count++;
          existing.dates.push(c.date);
        } else {
          habitMap.set(c.activityId, {
            name: c.activity.name,
            count: 1,
            category: c.activity.category || 'general',
            dates: [c.date],
          });
        }
      }

      for (const [, habit] of habitMap) {
        results.push({
          type: 'habit_completion',
          habitName: habit.name,
          count: habit.count,
          category: habit.category,
          streak: this.calculateConsecutiveDays(habit.dates),
        });
      }

      // 2. Nutrition analysis summary
      const nutritionLogs = await this.prisma.nutritionAnalysis.findMany({
        where: {
          userId,
          date: { gte: cutoffDateStr },
        },
        select: { totalCalories: true, mealType: true, date: true },
      });

      if (nutritionLogs.length > 0) {
        const totalCalories = nutritionLogs.reduce(
          (sum, n) => sum + (n.totalCalories || 0),
          0,
        );
        results.push({
          type: 'nutrition',
          count: nutritionLogs.length,
          avgCalories: Math.round(totalCalories / nutritionLogs.length),
          totalCalories,
          uniqueDays: new Set(nutritionLogs.map((n) => n.date)).size,
        });
      }

      // 3. Physical activity summary
      const activities = await this.prisma.physicalActivity.findMany({
        where: {
          userId,
          date: { gte: cutoffDateStr },
        },
        select: {
          exerciseMinutes: true,
          activeEnergyKcal: true,
          steps: true,
          date: true,
        },
      });

      if (activities.length > 0) {
        const totalMinutes = activities.reduce(
          (sum, a) => sum + (a.exerciseMinutes || 0),
          0,
        );
        const totalSteps = activities.reduce(
          (sum, a) => sum + (a.steps || 0),
          0,
        );
        results.push({
          type: 'physical_activity',
          count: activities.length,
          avgMinutes: Math.round(totalMinutes / activities.length),
          totalSteps,
          totalCaloriesBurned: activities.reduce(
            (sum, a) => sum + (a.activeEnergyKcal || 0),
            0,
          ),
        });
      }

      // 4. Mood from notes
      const notes = await this.prisma.note.findMany({
        where: {
          userId,
          date: { gte: cutoffDateStr },
        },
        select: { mood: true, date: true },
      });

      if (notes.length > 0) {
        const totalMood = notes.reduce((sum, n) => sum + (n.mood || 3), 0);
        results.push({
          type: 'mood',
          count: notes.length,
          avgMood: Math.round((totalMood / notes.length) * 10) / 10,
        });
      }
    } catch (error) {
      console.error('Error fetching recent analysis:', error);
    }

    return results;
  }

  /**
   * Detects real patterns from user data
   */
  async detectPatterns(userId: string): Promise<any> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const cutoffDateStr = sevenDaysAgo.toISOString().split('T')[0];

      // Get streaks
      const userStreaks = await this.prisma.userStreak.findMany({
        where: { userId },
        include: { streakType: true },
      });

      const streakData: Record<string, { count: number; lastDate: string | null }> = {};
      let longestStreak = 0;
      let longestStreakName = '';

      for (const s of userStreaks) {
        streakData[s.streakType.code] = {
          count: s.count,
          lastDate: s.lastDate,
        };
        if (s.count > longestStreak) {
          longestStreak = s.count;
          longestStreakName = s.streakType.name;
        }
      }

      // Get most completed habit
      const topHabits = await this.prisma.dailyCompletion.groupBy({
        by: ['activityId'],
        where: {
          activity: { userId },
          date: { gte: cutoffDateStr },
          completed: true,
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 3,
      });

      const topHabitNames: string[] = [];
      for (const h of topHabits) {
        const activity = await this.prisma.activity.findUnique({
          where: { id: h.activityId },
          select: { name: true },
        });
        if (activity) {
          topHabitNames.push(activity.name);
        }
      }

      // Nutrition consistency
      const nutritionDays = await this.prisma.nutritionAnalysis.groupBy({
        by: ['date'],
        where: { userId, date: { gte: cutoffDateStr } },
      });

      // Activity consistency
      const activityDays = await this.prisma.physicalActivity.groupBy({
        by: ['date'],
        where: { userId, date: { gte: cutoffDateStr } },
      });

      // Notes/mood trend
      const recentNotes = await this.prisma.note.findMany({
        where: { userId, date: { gte: cutoffDateStr } },
        select: { mood: true },
        orderBy: { date: 'asc' },
      });

      const avgMood =
        recentNotes.length > 0
          ? recentNotes.reduce((s, n) => s + (n.mood || 3), 0) /
            recentNotes.length
          : null;

      // Build recommendations
      const recommendations: string[] = [];
      const strengths: string[] = [];
      const needsImprovement: string[] = [];

      if (longestStreak >= 7) {
        strengths.push('consistency');
        recommendations.push(
          `Tu racha de ${longestStreakName} de ${longestStreak} días muestra gran constancia`,
        );
      } else if (longestStreak >= 3) {
        strengths.push('building_habits');
        recommendations.push(
          `Vas por buen camino con ${longestStreakName} (${longestStreak} días). ¡Seguí así!`,
        );
      }

      if (nutritionDays.length >= 5) {
        strengths.push('nutrition_tracking');
      } else if (nutritionDays.length < 3) {
        needsImprovement.push('nutrition_consistency');
        recommendations.push(
          'Intentá registrar tus comidas más seguido para obtener mejores insights',
        );
      }

      if (activityDays.length >= 3) {
        strengths.push('active_lifestyle');
      } else {
        needsImprovement.push('physical_activity');
        recommendations.push(
          'Registrá más actividad física — incluso caminar cuenta',
        );
      }

      if (avgMood !== null && avgMood >= 4) {
        strengths.push('positive_mindset');
      } else if (avgMood !== null && avgMood < 3) {
        recommendations.push(
          'Tu estado de ánimo ha estado bajo. Considerá actividades que te hagan sentir bien',
        );
      }

      if (topHabitNames.length > 0) {
        recommendations.push(
          `Tus hábitos más consistentes: ${topHabitNames.join(', ')}`,
        );
      }

      return {
        streaks: {
          current_longest: longestStreak,
          habit: longestStreakName || 'Ninguno',
          details: streakData,
        },
        trends: {
          top_habits: topHabitNames,
          nutrition_days_logged: nutritionDays.length,
          activity_days_logged: activityDays.length,
          average_mood: avgMood,
        },
        recommendations,
        strengths,
        needs_improvement: needsImprovement,
      };
    } catch (error) {
      console.error('Error detecting patterns:', error);
      return {
        streaks: { current_longest: 0, habit: 'Ninguno' },
        trends: {},
        recommendations: ['No hay suficientes datos todavía. ¡Seguí registrando!'],
        strengths: [],
        needs_improvement: [],
      };
    }
  }

  private calculateConsecutiveDays(dates: string[]): number {
    if (dates.length === 0) return 0;
    const sorted = [...new Set(dates)].sort().reverse();
    let streak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]);
      const curr = new Date(sorted[i]);
      const diffMs = prev.getTime() - curr.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (Math.abs(diffDays - 1) < 0.1) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }
}
