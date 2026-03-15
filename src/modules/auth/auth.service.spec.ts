import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../config/prisma.service';
import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    password: '$2a$12$hashedpassword',
    plan: 'free',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              create: jest.fn(),
            },
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn().mockResolvedValue('mock-token'),
            verify: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.register({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      });

      expect(result.user.email).toBe('test@example.com');
      expect(result.user.name).toBe('Test User');
      expect(result.tokens).toBeDefined();
      expect(result.tokens.accessToken).toBe('mock-token');
      expect(result.tokens.refreshToken).toBe('mock-token');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'test@example.com',
            name: 'Test User',
            plan: 'free',
            isActive: true,
          }),
        }),
      );
    });

    it('should throw ConflictException when email already exists', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test User',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should hash the password before storing', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);

      await service.register({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      });

      const createCall = (prisma.user.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.password).not.toBe('password123');
      const isHashed = await bcrypt.compare(
        'password123',
        createCall.data.password,
      );
      expect(isHashed).toBe(true);
    });
  });

  describe('login', () => {
    it('should login successfully with correct credentials', async () => {
      const hashedPassword = await bcrypt.hash('password123', 12);
      const userWithHash = { ...mockUser, password: hashedPassword };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(userWithHash);

      const result = await service.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.user.email).toBe('test@example.com');
      expect(result.tokens.accessToken).toBe('mock-token');
      expect(result.tokens.refreshToken).toBe('mock-token');
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.login({
          email: 'nonexistent@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const hashedPassword = await bcrypt.hash('password123', 12);
      const userWithHash = { ...mockUser, password: hashedPassword };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(userWithHash);

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for inactive user', async () => {
      const hashedPassword = await bcrypt.hash('password123', 12);
      const inactiveUser = {
        ...mockUser,
        password: hashedPassword,
        isActive: false,
      };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(inactiveUser);

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('generateTokens (via register)', () => {
    it('should call jwtService.signAsync twice for access and refresh tokens', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);

      await service.register({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      });

      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: mockUser.id,
          email: mockUser.email,
          name: mockUser.name,
          plan: mockUser.plan,
        }),
        expect.objectContaining({ expiresIn: '3d' }),
      );
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: mockUser.id,
          email: mockUser.email,
        }),
        expect.objectContaining({ expiresIn: '7d' }),
      );
    });
  });
});
