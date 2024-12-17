import pino from 'pino';
import pinoPretty from 'pino-pretty';

const level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

const baseLogger = pino({
  level,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss.l',
      messageFormat: '[{module}] {msg}',
      ignore: 'module'
    }
  }
});

export const createLogger = (module) => {
  return baseLogger.child({ module });
};

export default baseLogger; 