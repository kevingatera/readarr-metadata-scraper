import fs from 'fs/promises';
import path from 'path';

const CACHE_DIR = process.env.CACHE_DIR || './cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function getFromCache(key) {
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    const { timestamp, value } = JSON.parse(data);

    if (Date.now() - timestamp > CACHE_TTL) {
      console.log(`Cache expired for key: ${key}`);
      await fs.unlink(filePath);
      return null;
    }

    const age = Math.round((Date.now() - timestamp) / 1000 / 60);
    console.log(`Cache hit for ${key} (age: ${age}min)`);
    return value;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Cache read error for ${key}:`, error.message);
    }
    return null;
  }
}

export async function saveToCache(key, value) {
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    await fs.writeFile(filePath, JSON.stringify({
      timestamp: Date.now(),
      value
    }));
    console.log(`Cached ${key}`);
  } catch (error) {
    console.error(`Cache write failed for ${key}:`, error.message);
  }
} 