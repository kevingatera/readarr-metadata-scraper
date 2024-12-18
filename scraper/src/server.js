import express from 'express'
import http from "http";
import https from "https";
import { getBook, getEditions } from './bookscraper.js'
import getAuthor from "./authorscraper.js";
import { getFromCache, saveToCache } from './cache.js';

import fs from 'fs';
import { mkdir } from 'fs/promises';
const CACHE_DIR = process.env.CACHE_DIR || './cache';
await mkdir(CACHE_DIR, { recursive: true });

import crypto from 'crypto';
import { createLogger } from './logger.js';
import { FetchError } from './utils/fetch.js';

const logger = createLogger('SERVER');

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
    logger.debug(`Endpoint called: /v1/author/${id}`);
    logger.info(`Requesting author ID: ${id}`);
    const goodreadsUrl = `https://www.goodreads.com/author/show/${id}`;

    try {
      const authorInfo = await getAuthor(id, goodreadsUrl);
      res.send({ ...authorInfo, Works: [] });
    } catch (error) {
      if (error instanceof FetchError && error.status === 404) {
        return res.status(404).send({ error: 'Author not found' });
      }
      throw error;
    }
  } catch (error) {
    logger.error(`Failed to fetch author ${req.params.id}: ${error}`);
    res.status(500).send({ error: 'Internal server error' });
  }
});
app.get('/v1/work/:id', async (req, res) => {
  try {
    const workId = req.params.id;
    logger.debug(`Endpoint called: /v1/work/${workId}`);
    logger.info(`Getting work/book ID: ${workId}`);

    try {
      // First try to get editions assuming it's a work ID
      const editions = await fetchWithRetry(getEditions, workId);

      // It was a valid work ID
      const primaryEdition = editions[0];
      const primaryBookDetails = await fetchWithRetry(getBook, primaryEdition.ForeignId);
      const series = primaryBookDetails.Series || [];

      const authorIds = editions.flatMap(edition => {
        return edition.Contributors.map(contributor => contributor.ForeignId).filter(id => id);
      });

      const uniqueAuthorIds = [...new Set(authorIds)];

      const authorResults = await batchFetchWithRetry(
        (authorId) => getAuthor(
          authorId,
          `https://www.goodreads.com/author/show/${authorId}`
        ),
        uniqueAuthorIds
      );

      return res.send({
        ForeignId: parseInt(workId),
        Title: primaryEdition.Title,
        Url: `https://www.goodreads.com/work/editions/${workId}`,
        Genres: [],
        RelatedWorks: editions.map(edition => edition.ForeignId),
        Books: editions,
        Series: series || [],
        Authors: Object.values(authorResults)
      });

    } catch (error) {
      if (error instanceof FetchError && error.status === 404) {
        // Maybe it's a book ID - try getting book details directly
        const bookDetails = await fetchWithRetry(getBook, workId);
        if (!bookDetails) {
          return res.status(404).send({ error: 'Work/Book not found' });
        }

        // If successful, treat this single book as an edition
        return res.send({
          ForeignId: parseInt(workId),
          Title: bookDetails.Title,
          Url: bookDetails.Url,
          Genres: bookDetails.Genres || [],
          RelatedWorks: [],
          Books: bookDetails.Editions || [],
          Series: bookDetails.Series || [],
          Authors: await getAuthorsForEditions(bookDetails.Editions)
        });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof FetchError && error.status === 404) {
      return res.status(404).send({ error: 'Work/Book not found' });
    }

    logger.error(`Failed to fetch work/book ${req.params.id}: ${error}`);
    return res.status(500).send({ error: 'Internal server error' });
  }
});

// Helper function to get authors for editions
async function getAuthorsForEditions(editions) {
  const authorIds = editions.flatMap(edition =>
    edition.Contributors.map(contributor => contributor.ForeignId)
  ).filter(id => id);

  const uniqueAuthorIds = [...new Set(authorIds)];

  const authorResults = await batchFetchWithRetry(
    (authorId) => getAuthor(
      authorId,
      `https://www.goodreads.com/author/show/${authorId}`
    ),
    uniqueAuthorIds
  );

  return Object.values(authorResults);
}

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
      if (error instanceof FetchError && error.status === 404) {
        logger.error(`404 for ${fetchFn.name} with args: ${args}, not retrying`);
        throw error;
      }

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
      if (error instanceof FetchError && error.status === 404) {
        results[id] = null;
        continue;
      }
      results[id] = createFallbackResponse(fetchFn, [id]);
    }
  }

  return results;
}

app.post('*', async (req, res) => {
  try {
    logger.info({
      msg: 'Processing POST request',
      body: req.body,
      bodyCount: req.body?.length || 'N/A',
      requestSize: JSON.stringify(req.body).length
    });

    const bookResults = await batchFetchWithRetry(getBook, req.body);
    logger.info({
      msg: 'Book fetch results',
      bookCount: Object.keys(bookResults).length
    });

    const authorIds = [...new Set(
      Object.values(bookResults)
        .flatMap(book => book.Contributors.map(contributor => contributor.ForeignId))
        .filter(id => id)
    )];
    logger.info({
      msg: 'Extracted author IDs',
      authorIdCount: authorIds.length,
      authorIds
    });

    const authorResults = await batchFetchWithRetry(
      (authorId) => getAuthor(
        authorId,
        `https://www.goodreads.com/author/show/${authorId}`
      ),
      authorIds
    );
    logger.info({
      msg: 'Author fetch results',
      authorCount: Object.keys(authorResults).length
    });

    const works = Object.values(bookResults)
      .map(book => ({
        ForeignId: book.ForeignId,
        Title: book.Title,
        Url: book.Url,
        Genres: book?.Genres || [],
        RelatedWorks: [],
        Books: [book],
        Series: book.Series || [],
        Authors: book.Contributors.map(contributor => authorResults[contributor.ForeignId])
      }));

    const response = {
      Works: works,
      Series: works.flatMap(work => work.Series),
      Authors: Object.values(authorResults)
    };

    logger.info({
      msg: 'Final response summary',
      workCount: works.length,
      authorCount: response.Authors.length
    });

    res.send(response);
  } catch (error) {
    logger.error({
      msg: 'Error processing request',
      error: error.message,
      stack: error.stack
    });
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