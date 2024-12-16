import express from 'express'
import http from "http";
import https from "https";
import { getBook } from './bookscraper.js'
import getAuthor from "./authorscraper.js";
import { getFromCache, saveToCache } from './cache.js';

import fs from 'fs';
const CACHE_DIR = process.env.CACHE_DIR || './cache';
await fs.mkdir(CACHE_DIR, { recursive: true });

import crypto from 'crypto';

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
    const id = req.params.id
    console.log('requesting author id /v1/author', id)
    const goodreadsUrl = `https://www.goodreads.com/author/show/${id}`
    const authorInfo = await getAuthor(id, goodreadsUrl)
    console.log(authorInfo)
    res.status(200);
    res.send({ ...authorInfo, Works: [] })
});
app.get('/v1/work/:id', async (req, res) => {
    const id = req.params.id
    console.log('getting work /v1/work', id)
    const { work, author } = await getBook(id)
    const authorInfo = await getAuthor(author[0].id, author[0].url)
    const response = {
        ForeignId: work.ForeignId,
        Title: work.Title,
        Url: work.Url,
        Genres: ["horror"],
        RelatedWorks: [],
        Books: [work],
        Series: [],
        Authors: [authorInfo]
    }
    console.log(response)
    res.send(response)
});

let lastRequestTime = 0;

async function rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();
}

async function fetchWithRetry(fetchFn, ...args) {
    const cacheKey = generateCacheKey(fetchFn, args);
    const cached = await getFromCache(cacheKey);
    if (cached) {
        console.log(`Cache hit for ${fetchFn.name} with args: ${args}`);
        return cached;
    }
    console.log(`Cache miss for ${fetchFn.name} with args: ${args}`);

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
                console.error(`All ${MAX_RETRIES} attempts failed for ${fetchFn.name}:`, error);
                break;
            }

            const delay = Math.min(BASE_DELAY * Math.pow(2, attempt - 1), MAX_DELAY);
            console.log(`Attempt ${attempt} failed for ${fetchFn.name}. Retrying in ${delay / 1000}s`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    return createFallbackResponse(fetchFn, args);
}

function createFallbackResponse(fetchFn, args) {
    const id = args[0];
    if (fetchFn.name === 'getBook') {
        return {
            work: {
                ForeignId: parseInt(id),
                Title: `Unavailable Book ${id}`,
                Url: `https://www.goodreads.com/book/show/${id}`,
                Description: "This book is temporarily unavailable",
                AverageRating: 0,
                RatingCount: 0
            },
            author: [{
                id: 0,
                name: "Unknown Author",
                url: ""
            }]
        };
    }
    if (fetchFn.name === 'getAuthor') {
        return {
            ForeignId: parseInt(id),
            Name: "Unknown Author",
            Description: "Author information temporarily unavailable",
            AverageRating: 0,
            RatingCount: 0,
            Url: `https://www.goodreads.com/author/show/${id}`,
            ImageUrl: "",
            Series: null,
            Works: null
        };
    }
}

async function batchFetchWithRetry(fetchFn, ids) {
    const uniqueIds = [...new Set(ids)];
    const results = {};

    for (const id of uniqueIds) {
        try {
            const result = await fetchWithRetry(fetchFn, id);
            results[id] = result;
        } catch (error) {
            console.error(`Failed to fetch ${id}:`, error);
            results[id] = createFallbackResponse(fetchFn, [id]);
        }
    }

    return results;
}

app.post('*', async (req, res) => {
    try {
        console.log('post body', req.body);

        const bookResults = await batchFetchWithRetry(getBook, req.body);

        const authorIds = [...new Set(
            Object.values(bookResults)
                .filter(book => book?.author?.[0])
                .map(book => book.author[0].id)
        )];

        const authorResults = await batchFetchWithRetry(getAuthor, authorIds);

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
        console.error('Error processing request:', error);
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
    console.log('listening...')
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