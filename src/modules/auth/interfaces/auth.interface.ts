export interface JwtPayload {
  sub: string; // user ID
  email: string;
  name: string;
  plan: string;
  iat?: number;
  exp?: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  password: string;
  plan: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: Partial<User>;
  tokens: AuthTokens;
  expiresAt: Date;
}

export interface RequestWithUser extends Request {
  user: JwtPayload;
}
