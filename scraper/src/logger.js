import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

const logFormat = printf(({ level, message, timestamp, module }) => {
  return `${timestamp} [${level.toUpperCase()}] [${module || 'SERVER'}]: ${message}`;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp(),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp(),
        logFormat
      )
    })
  ]
});

export const createLogger = (module) => ({
  debug: (message) => logger.debug(message, { module }),
  info: (message) => logger.info(message, { module }),
  warn: (message) => logger.warn(message, { module }),
  error: (message) => logger.error(message, { module })
});

export default logger; 