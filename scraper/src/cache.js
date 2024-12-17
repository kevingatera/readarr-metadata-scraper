import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';
const logger = createLogger('CACHE');

const CACHE_DIR = process.env.CACHE_DIR || './cache';
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '86400000'); // 24h default
const CACHE_ENABLED = process.env.CACHE_ENABLED !== 'false'; // enabled by default

export async function getFromCache(key) {
  if (!CACHE_ENABLED) return null;

  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    const { timestamp, value } = JSON.parse(data);

    if (Date.now() - timestamp > CACHE_TTL) {
      logger.debug(`Cache expired for key: ${key}`);
      await fs.unlink(filePath);
      return null;
    }

    const age = Math.round((Date.now() - timestamp) / 1000 / 60);
    logger.info(`Cache hit for ${key} (age: ${age}min)`);
    return value;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error(`Cache read error for ${key}: ${error.message}`);
    }
    return null;
  }
}

export async function saveToCache(key, value) {
  if (!CACHE_ENABLED) return;

  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    await fs.writeFile(filePath, JSON.stringify({
      timestamp: Date.now(),
      value
    }));
    logger.info(`Cached ${key}`);
  } catch (error) {
    logger.error(`Cache write failed for ${key}: ${error.message}`);
  }
} 