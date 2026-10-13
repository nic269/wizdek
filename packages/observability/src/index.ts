export const health = () => ({ ok: true, time: new Date().toISOString() });

export const isSentryEnabled = () => Boolean(process.env.SENTRY_DSN);
