import pino, { type DestinationStream } from 'pino';

const sensitiveKeys = /^(api[_-]?key|token|authorization|secret|webhooksecret|key|phone|phone_number|body|text|content)$/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sensitiveKeys.test(key) ? '[REDACTED]' : redact(entry)]),
    );
  }
  return value;
}

export function createLogger(destination?: DestinationStream) {
  const logger = pino({ base: null }, destination);
  return {
    info(details: object, message: string) {
      logger.info(redact(details), message);
    },
    error(details: object, message: string) {
      logger.error(redact(details), message);
    },
  };
}
