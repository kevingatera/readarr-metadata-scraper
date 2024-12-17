import express from 'express'
import http from "http";
import https from "https";
import { getBook } from './bookscraper.js'
import getAuthor from "./authorscraper.js";
import { getFromCache, saveToCache } from './cache.js';

import fs from 'fs';
import { mkdir } from 'fs/promises';
const CACHE_DIR = process.env.CACHE_DIR || './cache';
await mkdir(CACHE_DIR, { recursive: true });

import crypto from 'crypto';
import logger from './logger.js';

function generateCacheKey(fetchFn, args) {
  return `${fetchFn.name}_${crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex')}`;
}

const MAX_RETRIES = 10;
const BASE_DELAY = 2000;
const MAX_DELAY = 60000;
const RATE_LIMIT_DELAY = 2000;

const privateKey = fs.readFileSync('./certs/bookinfo-club.key', 'utf8');
const certificate = fs.readFileSync('./certs/bookinfo-club.crt', 'utf8');

const credentials = { key: privateKey, cert: certificate };

const app = express()
app.use(express.json())

app.get('/v1/author/:id', async (req, res) => {
  try {
    const id = req.params.id;
    logger.info(`Requesting author ID: ${id}`);
    const goodreadsUrl = `https://www.goodreads.com/author/show/${id}`;
    const authorInfo = await getAuthor(id, goodreadsUrl);
    res.send({ ...authorInfo, Works: [] });
  } catch (error) {
    logger.error(`Failed to fetch author ${req.params.id}: ${error}`);
    res.status(404).send({ error: 'Author not found' });
  }
});
app.get('/v1/work/:id', async (req, res) => {
  try {
    const id = req.params.id;
    logger.info(`Getting work ID: ${id}`);
    const { work, author } = await getBook(id);
    const authorInfo = await getAuthor(author[0].id, author[0].url);
    res.send({
      ForeignId: work.ForeignId,
      Title: work.Title,
      Url: work.Url,
      Genres: ["horror"],
      RelatedWorks: [],
      Books: [work],
      Series: [],
      Authors: [authorInfo]
    });
  } catch (error) {
    logger.error(`Failed to fetch work ${req.params.id}: ${error}`);
    res.status(404).send({ error: 'Work not found' });
  }
});

let lastRequestTime = 0;

async function rateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
  logger.debug(`Rate limiting: waiting ${RATE_LIMIT_DELAY - timeSinceLastRequest}ms`);
}

async function fetchWithRetry(fetchFn, ...args) {
  const cacheKey = generateCacheKey(fetchFn, args);
  const cached = await getFromCache(cacheKey);
  if (cached) {
    logger.debug(`Cache hit for ${fetchFn.name} with args: ${args}`);
    return cached;
  }
  logger.debug(`Cache miss for ${fetchFn.name} with args: ${args}`);

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await rateLimit();
      const result = await fetchFn(...args);
      await saveToCache(cacheKey, result);
      return result;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) {
        logger.error(`All ${MAX_RETRIES} attempts failed for ${fetchFn.name}:`, error);
        break;
      }

      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt - 1), MAX_DELAY);
      logger.warn(`Attempt ${attempt} failed for ${fetchFn.name}. Retrying in ${delay / 1000}s`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return createFallbackResponse(fetchFn, args);
}

function createFallbackResponse(fetchFn, args) {
  throw new Error(`Failed to fetch ${fetchFn.name} with id ${args[0]}`);
}

async function batchFetchWithRetry(fetchFn, ids) {
  const uniqueIds = [...new Set(ids)];
  const results = {};

  for (const id of uniqueIds) {
    try {
      const result = await fetchWithRetry(fetchFn, id);
      results[id] = result;
    } catch (error) {
      logger.error(`Failed to fetch ${id}:`, error);
      results[id] = createFallbackResponse(fetchFn, [id]);
    }
  }

  return results;
}

app.post('*', async (req, res) => {
  try {
    logger.info('Processing POST request', req.body);

    const bookResults = await batchFetchWithRetry(getBook, req.body);

    const authorIds = [...new Set(
      Object.values(bookResults)
        .filter(book => book?.author?.[0])
        .map(book => book.author[0].id)
    )];

    const authorResults = await batchFetchWithRetry(
      (authorId) => getAuthor(
        authorId,
        `https://www.goodreads.com/author/show/${authorId}`
      ),
      authorIds
    );

    const works = Object.values(bookResults)
      .filter(book => book?.work)
      .map(({ work }) => ({
        ForeignId: work.ForeignId,
        Title: work.Title,
        Url: work.Url,
        Genres: ["horror"],
        RelatedWorks: [],
        Books: [work],
        Series: []
      }));

    const response = {
      Works: works,
      Series: [],
      Authors: Object.values(authorResults)
    };

    res.send(response);
  } catch (error) {
    logger.error(`Error processing request: ${error}`);
    res.status(500).send({
      Works: [],
      Series: [],
      Authors: []
    });
  }
});

const httpServer = http.createServer(app);
const httpsServer = https.createServer(credentials, app);

httpServer.listen(80, async () => {
  logger.info('HTTP server listening on port 80');
}
);
try {
  const privateKey = fs.readFileSync('./certs/bookinfo-club.key', 'utf8');
  const certificate = fs.readFileSync('./certs/bookinfo-club.crt', 'utf8');
  const credentials = { key: privateKey, cert: certificate };
  const httpsServer = https.createServer(credentials, app);
  httpsServer.listen(443);
} catch (error) {
  console.warn('SSL certificates not found, HTTPS server not started');
}

// app.listen(8816, async () => {
//     console.log('listening')
//     console.log(privateKey)
// })