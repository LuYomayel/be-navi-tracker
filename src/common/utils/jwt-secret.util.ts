/**
 * Devuelve el secreto JWT pedido.
 *
 * En produccion NO hay fallback: si falta la env var lanza (fail-fast). El
 * fallback que habia antes era una constante fija y publicada en el repo
 * ('super-secret-jwt-key-change-in-production'), asi que cualquiera que
 * conociera el codigo podia firmarse un token valido si la variable no estaba
 * cargada. Fuera de produccion se usa un valor explicito de dev/test.
 *
 * Es el mismo criterio que ya aplicaba McpAuthService.secret().
 */
export function requireJwtSecret(
  name: 'JWT_SECRET' | 'JWT_REFRESH_SECRET',
): string {
  const value = process.env[name];
  if (value) return value;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Falta la variable de entorno ${name} (requerida en produccion)`,
    );
  }

  return name === 'JWT_SECRET'
    ? 'dev-only-insecure-jwt-secret'
    : 'dev-only-insecure-jwt-refresh-secret';
}
