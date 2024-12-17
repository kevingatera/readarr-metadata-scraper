import pino from 'pino';

const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'yyyy-mm-dd HH:MM:ss.l',
    messageFormat: '[{module}] {msg}',
    ignore: 'module'
  }
});

const baseLogger = pino(transport);

export const createLogger = (module) => {
  return baseLogger.child({ module });
};

export default baseLogger; 