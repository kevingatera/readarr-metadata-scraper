import { createLogger } from '../logger.js';
const logger = createLogger('FETCH');

const FETCH_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

export class FetchError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = 'FetchError';
  }
}

export async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: controller.signal
      });

      if (response.status === 404) {
        throw new FetchError('Resource not found', 404);
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      if (error instanceof FetchError && error.status === 404) {
        throw error;
      }

      if (attempt === MAX_RETRIES) {
        logger.error(`Failed to fetch ${url}: ${error}`);
        throw error;
      }
      logger.warn(`Attempt ${attempt} failed for ${url}. Retrying in ${RETRY_DELAY}ms`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    } finally {
      clearTimeout(timeoutId);
    }
  }
} 