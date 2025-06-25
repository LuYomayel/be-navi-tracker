import {
  Controller,
  Post,
  Body,
  Get,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, RefreshTokenDto } from './dto/auth.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtPayload } from './interfaces/auth.interface';
import { ApiResponse } from '../../common/types';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() registerDto: RegisterDto): Promise<ApiResponse<any>> {
    try {
      const result = await this.authService.register(registerDto);

      return {
        success: true,
        data: {
          message: 'Usuario registrado exitosamente',
          user: result.user,
          tokens: result.tokens,
          expiresAt: result.expiresAt,
        },
      };
    } catch (error) {
      console.error('Error en register:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Public()
  @Post('login')
  async login(@Body() loginDto: LoginDto): Promise<ApiResponse<any>> {
    try {
      const result = await this.authService.login(loginDto);

      return {
        success: true,
        data: {
          message: 'Inicio de sesión exitoso',
          user: result.user,
          tokens: result.tokens,
          expiresAt: result.expiresAt,
        },
      };
    } catch (error) {
      console.error('Error en login:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Public()
  @Post('refresh')
  async refreshToken(
    @Body() refreshTokenDto: RefreshTokenDto,
  ): Promise<ApiResponse<any>> {
    try {
      const tokens = await this.authService.refreshToken(
        refreshTokenDto.refreshToken,
      );

      return {
        success: true,
        data: {
          message: 'Tokens renovados exitosamente',
          tokens,
        },
      };
    } catch (error) {
      console.error('Error en refresh token:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('logout')
  async logout(): Promise<ApiResponse<{ message: string }>> {
    try {
      const result = await this.authService.logout();
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('Error en logout:', error);
      throw new HttpException(
        'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('profile')
  async getProfile(@CurrentUser() user: JwtPayload): Promise<ApiResponse<any>> {
    try {
      const profile = await this.authService.getProfile(user.sub);

      return {
        success: true,
        data: {
          user: profile,
        },
      };
    } catch (error) {
      console.error('Error obteniendo perfil:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('verify')
  async verifyToken(
    @CurrentUser() user: JwtPayload,
  ): Promise<ApiResponse<any>> {
    return {
      success: true,
      data: {
        message: 'Token válido',
        user,
      },
    };
  }
}
