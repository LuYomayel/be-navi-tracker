import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Email debe ser un email válido' })
  email: string;

  @IsString({ message: 'Password debe ser un string' })
  @MinLength(6, { message: 'Password debe tener al menos 6 caracteres' })
  password: string;
}

export class RegisterDto {
  @IsEmail({}, { message: 'Email debe ser un email válido' })
  email: string;

  @IsString({ message: 'Password debe ser un string' })
  @MinLength(6, { message: 'Password debe tener al menos 6 caracteres' })
  @MaxLength(50, { message: 'Password no puede tener más de 50 caracteres' })
  password: string;

  @IsString({ message: 'Nombre debe ser un string' })
  @MinLength(2, { message: 'Nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, { message: 'Nombre no puede tener más de 100 caracteres' })
  name: string;
}

export class RefreshTokenDto {
  @IsString({ message: 'Refresh token debe ser un string' })
  refreshToken: string;
}
