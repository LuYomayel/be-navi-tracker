import { Test, TestingModule } from '@nestjs/testing';
import { NotesService } from './notes.service';
import { PrismaService } from '../../config/prisma.service';

describe('NotesService', () => {
  let service: NotesService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockNote = {
    id: 'note-1',
    date: '2024-01-15',
    mood: 4,
    energy: 3,
    predefinedComments: ['productive', 'focused'],
    customComment: 'Great day',
    userId,
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-15'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        {
          provide: PrismaService,
          useValue: {
            note: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<NotesService>(NotesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getAll', () => {
    it('should return all notes for a user', async () => {
      (prisma.note.findMany as jest.Mock).mockResolvedValue([mockNote]);

      const result = await service.getAll(userId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('note-1');
      expect(result[0].predefinedComments).toEqual(['productive', 'focused']);
      expect(prisma.note.findMany).toHaveBeenCalledWith({
        where: { user: { id: userId } },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should return empty array when no notes exist', async () => {
      (prisma.note.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getAll(userId);

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      (prisma.note.findMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.getAll(userId);

      expect(result).toEqual([]);
    });

    it('should handle null predefinedComments and customComment', async () => {
      const noteWithNulls = {
        ...mockNote,
        predefinedComments: null,
        customComment: null,
      };
      (prisma.note.findMany as jest.Mock).mockResolvedValue([noteWithNulls]);

      const result = await service.getAll(userId);

      expect(result[0].predefinedComments).toBeUndefined();
      expect(result[0].customComment).toBeUndefined();
    });
  });

  describe('create', () => {
    it('should create a note successfully', async () => {
      (prisma.note.create as jest.Mock).mockResolvedValue(mockNote);

      const result = await service.create(
        { date: '2024-01-15', mood: 4, energy: 3 } as any,
        userId,
      );

      expect(result.id).toBe('note-1');
      expect(prisma.note.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId }),
        }),
      );
    });

    it('should strip user and userId from input data', async () => {
      (prisma.note.create as jest.Mock).mockResolvedValue(mockNote);

      await service.create(
        { date: '2024-01-15', mood: 4, user: 'extra', userId: 'extra' } as any,
        userId,
      );

      const createCall = (prisma.note.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.user).toBeUndefined();
      expect(createCall.data.userId).toBe(userId);
    });

    it('should throw on database error', async () => {
      (prisma.note.create as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        service.create({ date: '2024-01-15', mood: 4 } as any, userId),
      ).rejects.toThrow('Error al crear nota');
    });
  });

  describe('update', () => {
    it('should update a note successfully', async () => {
      const updatedNote = { ...mockNote, mood: 5 };
      (prisma.note.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.note.findFirst as jest.Mock).mockResolvedValue(updatedNote);

      const result = await service.update('note-1', { mood: 5 } as any, userId);

      expect(result).not.toBeNull();
      expect(result!.mood).toBe(5);
      expect(prisma.note.updateMany).toHaveBeenCalledWith({
        where: { id: 'note-1', userId },
        data: expect.objectContaining({ mood: 5 }),
      });
    });

    it('should not reassign the owner of the note', async () => {
      (prisma.note.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.note.findFirst as jest.Mock).mockResolvedValue(mockNote);

      await service.update('note-1', { mood: 5 } as any, userId);

      const updateCall = (prisma.note.updateMany as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.userId).toBeUndefined();
      expect(updateCall.data.user).toBeUndefined();
    });

    it("should return null when the note belongs to another user", async () => {
      (prisma.note.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const result = await service.update(
        'note-de-otro',
        { mood: 5 } as any,
        userId,
      );

      expect(result).toBeNull();
      expect(prisma.note.findFirst).not.toHaveBeenCalled();
    });

    it('should return null on error', async () => {
      (prisma.note.updateMany as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      );

      const result = await service.update(
        'nonexistent',
        { mood: 5 } as any,
        userId,
      );

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a note with userId ownership check', async () => {
      (prisma.note.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await service.delete('note-1', userId);

      expect(result).toBe(true);
      expect(prisma.note.deleteMany).toHaveBeenCalledWith({
        where: { id: 'note-1', userId },
      });
    });

    it('should return false on error', async () => {
      (prisma.note.deleteMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.delete('note-1', userId);

      expect(result).toBe(false);
    });
  });
});
