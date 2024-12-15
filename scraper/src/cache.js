import fs from 'fs/promises';
import path from 'path';

const CACHE_DIR = process.env.CACHE_DIR || './cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function getFromCache(key) {
    try {
        const filePath = path.join(CACHE_DIR, `${key}.json`);
        const data = await fs.readFile(filePath, 'utf8');
        const {timestamp, value} = JSON.parse(data);
        
        if (Date.now() - timestamp > CACHE_TTL) {
            await fs.unlink(filePath);
            return null;
        }
        return value;
    } catch {
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
    } catch (error) {
        console.error('Cache write failed:', error);
    }
} 