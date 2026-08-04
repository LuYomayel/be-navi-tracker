import { requireJwtSecret } from './jwt-secret.util';

describe('requireJwtSecret', () => {
  const OLD_ENV = process.env;

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('devuelve el valor de la env var cuando esta cargada', () => {
    process.env = { ...OLD_ENV, JWT_SECRET: 'un-secreto-real' };
    expect(requireJwtSecret('JWT_SECRET')).toBe('un-secreto-real');
  });

  it('falla en produccion si falta el secreto', () => {
    process.env = { ...OLD_ENV, NODE_ENV: 'production' };
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    expect(() => requireJwtSecret('JWT_SECRET')).toThrow(/JWT_SECRET/);
    expect(() => requireJwtSecret('JWT_REFRESH_SECRET')).toThrow(
      /JWT_REFRESH_SECRET/,
    );
  });

  it('usa un fallback de dev fuera de produccion', () => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test' };
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    expect(requireJwtSecret('JWT_SECRET')).toBe('dev-only-insecure-jwt-secret');
    expect(requireJwtSecret('JWT_REFRESH_SECRET')).toBe(
      'dev-only-insecure-jwt-refresh-secret',
    );
  });

  it('el fallback de dev no es el secreto viejo que estaba en el repo', () => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test' };
    delete process.env.JWT_SECRET;

    expect(requireJwtSecret('JWT_SECRET')).not.toBe(
      'super-secret-jwt-key-change-in-production',
    );
  });
});
