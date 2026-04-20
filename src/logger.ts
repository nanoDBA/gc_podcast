/**
 * Minimal structured JSON-lines logger.
 *
 * Emits one JSON object per log call to stderr. Filterable via LOG_LEVEL
 * env var (debug | info | warn | error). Default level is "info".
 *
 * Usage:
 *   import { log } from './logger.js';
 *   log.info('starting scrape', { conference: '2026-04' });
 *   const talkLog = log.child({ talk: 'abc' });
 *   talkLog.warn('slow response', { ms: 1234 });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  child(context: LogContext): Logger;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveThreshold(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (raw in LEVELS) {
    return LEVELS[raw as LogLevel];
  }
  return LEVELS.info;
}

const threshold = resolveThreshold();

function emit(level: LogLevel, msg: string, bound: LogContext, context?: LogContext): void {
  if (LEVELS[level] < threshold) return;
  const entry: LogContext = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...bound,
    ...(context ?? {}),
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

function make(bound: LogContext): Logger {
  return {
    debug: (msg, context) => emit('debug', msg, bound, context),
    info: (msg, context) => emit('info', msg, bound, context),
    warn: (msg, context) => emit('warn', msg, bound, context),
    error: (msg, context) => emit('error', msg, bound, context),
    child: (context) => make({ ...bound, ...context }),
  };
}

export const log: Logger = make({});
