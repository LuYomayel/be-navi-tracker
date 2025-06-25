import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../config/prisma.service';
import * as bcrypt from 'bcryptjs';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import {
  User,
  JwtPayload,
  AuthTokens,
  AuthResponse,
} from './interfaces/auth.interface';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // Generar tokens JWT
  private async generateTokens(user: User): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret:
          process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production',
        expiresIn: '15m', // 15 minutos
      }),
      this.jwtService.signAsync(payload, {
        secret:
          process.env.JWT_REFRESH_SECRET ||
          'super-secret-refresh-key-change-in-production',
        expiresIn: '7d', // 7 días
      }),
    ]);

    return { accessToken, refreshToken };
  }

  // Hash password
  private async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  // Validar password
  private async validatePassword(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  // Registrar usuario
  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const { email, password, name } = registerDto;

    // Verificar si el email ya existe
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('El email ya está registrado');
    }

    // Hash password y crear usuario
    const hashedPassword = await this.hashPassword(password);

    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        plan: 'free',
        isActive: true,
      },
    });

    // Generar tokens
    const tokens = await this.generateTokens(user);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
      tokens,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutos
    };
  }

  // Login usuario
  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const { email, password } = loginDto;

    // Buscar usuario por email
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Validar password
    const isPasswordValid = await this.validatePassword(
      password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Verificar que el usuario esté activo
    if (!user.isActive) {
      throw new UnauthorizedException('Usuario desactivado');
    }

    // Generar tokens
    const tokens = await this.generateTokens(user);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
      tokens,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutos
    };
  }

  // Validar usuario por ID (para JWT strategy)
  async validateUserById(userId: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return null;
    }

    return user;
  }

  // Refresh token
  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret:
          process.env.JWT_REFRESH_SECRET ||
          'super-secret-refresh-key-change-in-production',
      });

      const user = await this.validateUserById(payload.sub);

      if (!user || !user.isActive) {
        throw new UnauthorizedException('Token inválido');
      }

      return this.generateTokens(user);
    } catch (error) {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  // Logout (en implementación real, aquí invalidarías el token en una blacklist)
  async logout(): Promise<{ message: string }> {
    // En una implementación completa, aquí podrías:
    // 1. Agregar el token a una blacklist en Redis
    // 2. Eliminar refresh tokens de la DB
    // 3. Limpiar sesiones activas

    return { message: 'Sesión cerrada exitosamente' };
  }

  // Obtener perfil del usuario
  async getProfile(userId: string): Promise<Partial<User>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    return user;
  }
}
