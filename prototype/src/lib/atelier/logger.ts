/**
 * Application logger mirroring the rally-hq reference implementation.
 *
 * Dev/Preview: Emits debug/info/warn.
 * Production: Emits error only (relies on Sentry for capture).
 */

const IS_PROD = process.env.NODE_ENV === 'production';

export const logger = {
  debug: (...args: unknown[]) => {
    if (!IS_PROD) console.debug('[debug]', ...args);
  },
  info: (...args: unknown[]) => {
    if (!IS_PROD) console.info('[info]', ...args);
  },
  warn: (...args: unknown[]) => {
    if (!IS_PROD) console.warn('[warn]', ...args);
  },
  error: (...args: unknown[]) => {
    console.error('[error]', ...args);
  },
};
