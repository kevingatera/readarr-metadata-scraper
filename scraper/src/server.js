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
      res.send(authorInfo);
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
      const bookDetails = await fetchWithRetry(getBook, workId);

      const work = {
        _id: workId,
        title: bookDetails.Title,
        subtitle: null,
        covers: [bookDetails.ImageUrl].filter(Boolean),
        authors: bookDetails.Contributors
          .filter(c => c.Role === "Author")
          .map(a => a.ForeignId),
        links: [{
          url: bookDetails.Url,
          title: "Goodreads"
        }],
        ratingCount: bookDetails.RatingCount,
        averageRating: bookDetails.AverageRating,
        description: bookDetails.Description,
        notes: null,
        firstPublishYear: bookDetails.ReleaseDate ? new Date(bookDetails.ReleaseDate).getFullYear() : null,
        createdAt: new Date(),
        updatedAt: new Date()
      }

      return res.send(work);
    } catch (error) {
      if (error instanceof FetchError && error.status === 404) {
        return res.status(404).send({ error: 'Work not found' });
      }
      throw error;
    }
  } catch (error) {
    logger.error(`Failed to fetch work ${req.params.id}: ${error}`);
    return res.status(500).send({ error: 'Internal server error' });
  }
});

app.get('/v1/edition/:id', async (req, res) => {
  try {
    const workId = req.params.id;
    logger.debug(`Endpoint called: /v1/edition/${workId}`);

    const editions = await fetchWithRetry(getEditions, workId);
    if (!editions?.length) {
      return res.status(404).send({ error: 'No editions found' });
    }

    // Transform to match Edition type
    const transformedEditions = editions.map(edition => {
      const publishDate = edition.ReleaseDate ? new Date(edition.ReleaseDate) : undefined;

      // Extract series info from title
      const seriesInfo = [];
      const seriesMatch = edition.Title.match(/(.*?)\s*\((.*?)\s*#(\d+)\)/);
      if (seriesMatch) {
        seriesInfo.push({
          name: seriesMatch[2].trim(),
          position: parseInt(seriesMatch[3])
        });
      }

      return {
        _id: edition.ForeignId.toString(),
        title: edition.Title.replace(/\s*\(.*?\)\s*$/, '').trim(), // Remove series info from title
        description: edition.Description,
        notes: '',
        editionName: edition.EditionInformation,

        series: seriesInfo,
        works: [workId], // Link back to parent work

        ratingCount: edition.RatingCount,
        averageRating: edition.AverageRating,

        authors: edition.Contributors
          .filter(c => c.Role === "Author")
          .map(a => a.ForeignId.toString()),

        publishCountry: '',
        publishDate: publishDate,
        publishers: edition.Publisher ? [edition.Publisher] : [],

        pagination: edition.NumPages ? `${edition.NumPages} pages` : undefined,
        numberOfPages: edition.NumPages,

        ids: {
          isbn13: edition.Isbn13,
          isbn10: null,
          lccn: null,
          oclcNumbers: [],
          localId: []
        },

        relatedLinks: [{
          url: edition.Url,
          title: "Goodreads"
        }],

        covers: edition.ImageUrl ? [edition.ImageUrl] : [],

        languages: edition.Language ? [edition.Language] : [],

        physicalFormat: edition.Format,

        createdAt: new Date(),
        updatedAt: new Date()
      };
    });

    return res.send(transformedEditions);
  } catch (error) {
    if (error instanceof FetchError && error.status === 404) {
      return res.status(404).send({ error: 'Editions not found' });
    }
    logger.error(`Failed to fetch editions ${req.params.id}: ${error}`);
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
  const waitTime = Math.max(0, RATE_LIMIT_DELAY - timeSinceLastRequest);

  if (waitTime > 0) {
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  lastRequestTime = Date.now();
  logger.debug(`Rate limiting: waiting ${waitTime}ms`);
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