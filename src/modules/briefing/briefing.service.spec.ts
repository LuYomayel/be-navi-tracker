import { Test, TestingModule } from '@nestjs/testing';
import { BriefingService } from './briefing.service';
import { PrismaService } from '../../config/prisma.service';
import { DayScoreService } from '../day-score/day-score.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivitiesService } from '../activities/activities.service';
import { HydrationService } from '../hydration/hydration.service';
import { GoalService } from '../goal/goal.service';
import { CalendarService } from '../calendar/calendar.service';
import { TrelloService } from '../trello/trello.service';
import { AICostService } from '../ai-cost/ai-cost.service';
import { EmailService } from './email.service';

describe('BriefingService', () => {
  let service: BriefingService;
  let prisma: any;
  let email: any;
  const OLD_ENV = process.env;

  const userId = 'u1';
  const date = '2026-06-07';

  afterEach(() => {
    process.env = OLD_ENV;
  });

  beforeEach(async () => {
    // Sin OpenAI en tests: la narrativa queda null (determinístico, sin red).
    process.env = { ...OLD_ENV };
    delete process.env.OPENAI_API_KEY;
    prisma = {
      briefing: {
        upsert: jest.fn().mockImplementation(({ create }) => ({
          id: 'b1',
          ...create,
        })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn() },
    };
    email = { send: jest.fn().mockResolvedValue(true), isConfigured: true };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        BriefingService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: DayScoreService,
          useValue: {
            getOrCalculate: jest
              .fn()
              .mockResolvedValue({ percentage: 60, status: 'partial' }),
          },
        },
        {
          provide: NutritionService,
          useValue: {
            getDailyNutritionBalance: jest.fn().mockResolvedValue({
              consumed: {
                calories: 1200,
                protein: 80,
                carbs: 100,
                fat: 40,
                fiber: 10,
              },
              goals: { dailyCalorieGoal: 2000, proteinGoal: 150 },
              netCalories: 1200,
            }),
          },
        },
        {
          provide: TasksService,
          useValue: {
            findAll: jest
              .fn()
              .mockResolvedValue([
                { title: 'Tarea A', priority: 'high', completed: false },
              ]),
          },
        },
        {
          provide: ActivitiesService,
          useValue: {
            getAll: jest.fn().mockResolvedValue([
              {
                name: 'Creatina',
                days: [true, true, true, true, true, true, true],
                completions: [{ date, completed: true }],
              },
            ]),
          },
        },
        {
          provide: HydrationService,
          useValue: {
            getByDate: jest.fn().mockResolvedValue({ glassesConsumed: 5 }),
          },
        },
        {
          provide: GoalService,
          useValue: {
            getProgress: jest.fn().mockResolvedValue({
              goal: { name: 'NZ' },
              percentage: 25.4,
              remainingUsd: 6000,
            }),
          },
        },
        {
          provide: CalendarService,
          useValue: { getEvents: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: TrelloService,
          useValue: { getTicketsSummary: jest.fn().mockResolvedValue('') },
        },
        {
          provide: AICostService,
          useValue: { logFromCompletion: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: EmailService, useValue: email },
      ],
    }).compile();

    service = moduleRef.get<BriefingService>(BriefingService);
  });

  describe('generate', () => {
    it('agrega el dia y persiste el briefing con text + html', async () => {
      const b = await service.generate(userId, date);

      expect(prisma.briefing.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId_date: { userId, date } } }),
      );
      const args = prisma.briefing.upsert.mock.calls[0][0];
      expect(args.create.text).toContain('Plan de hoy');
      expect(args.create.text).toContain('Creatina');
      expect(args.create.text).toContain('Tarea A');
      expect(args.create.html).toContain('<html');
      expect(args.create.content.score.percentage).toBe(60);
      expect(args.create.content.habits[0]).toEqual({
        name: 'Creatina',
        done: true,
      });
      expect(b.id).toBe('b1');
    });

    it('es resiliente si una seccion falla (nutrition lanza)', async () => {
      (service as any).nutrition.getDailyNutritionBalance = jest
        .fn()
        .mockRejectedValue(new Error('User preferences not found'));

      const b = await service.generate(userId, date);
      const args = prisma.briefing.upsert.mock.calls.pop()[0];
      expect(args.create.content.nutrition).toBeNull();
      expect(b).toBeDefined();
    });
  });

  describe('generateAndSend', () => {
    it('manda el mail al email del usuario y marca emailSent', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: userId,
        email: 'lu@x.com',
      });

      const res = await service.generateAndSend(userId, date);

      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'lu@x.com',
          subject: expect.stringContaining(date),
        }),
      );
      expect(prisma.briefing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ emailSent: true }),
        }),
      );
      expect(res.emailSent).toBe(true);
    });

    it('no manda mail si el usuario no tiene email', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: userId, email: '' });

      const res = await service.generateAndSend(userId, date);

      expect(email.send).not.toHaveBeenCalled();
      expect(res.emailSent).toBe(false);
    });
  });

  describe('renderText', () => {
    it('incluye dia, habitos, tareas e hidratacion', () => {
      const text = service.renderText({
        date,
        narrative: null,
        score: { percentage: 80, status: 'partial' },
        calendar: [],
        tickets: null,
        nutrition: null,
        habits: [{ name: 'Gym', done: false }],
        tasks: [{ title: 'Comprar', done: true }],
        hydration: { glasses: 3 },
        goal: null,
      });
      expect(text).toContain('80%');
      expect(text).toContain('⬜ Gym');
      expect(text).toContain('✅ Comprar');
      expect(text).toContain('💧 Agua: 3 vasos');
    });
  });
});
