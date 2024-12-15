import express from 'express'
import fs from "fs";
import http from "http";
import https from "https";
import { getBook } from './bookscraper.js'
import getAuthor from "./authorscraper.js";
import { getFromCache, saveToCache } from './cache.js';

import fs from 'fs/promises';
const CACHE_DIR = process.env.CACHE_DIR || './cache';
await fs.mkdir(CACHE_DIR, { recursive: true });

import crypto from 'crypto';

function generateCacheKey(fetchFn, args) {
    return `${fetchFn.name}_${crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex')}`;
}

const MAX_RETRIES = 5;
const BASE_DELAY = 1000; // 1 second

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


async function fetchWithRetry(fetchFn, ...args) {
    const cacheKey = generateCacheKey(fetchFn, args);
    const cached = await getFromCache(cacheKey);
    if (cached) {
        console.log(`Cache hit for ${fetchFn.name} with args: ${args}`);
        return cached;
    }
    console.log(`Cache miss for ${fetchFn.name} with args: ${args}`);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await fetchFn(...args);
            await saveToCache(cacheKey, result);
            return result;
        } catch (error) {
            if (attempt === MAX_RETRIES) throw error;

            const delay = BASE_DELAY * Math.pow(2, attempt - 1);
            console.log(`Attempt ${attempt} for ${fetchFn.name} failed. Retrying in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}


const RATE_LIMIT_DELAY = 2000; // 2 seconds between requests
let lastRequestTime = 0;

async function rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();
}

async function batchFetchWithRetry(fetchFn, ids) {
    // Deduplicate IDs
    const uniqueIds = [...new Set(ids)];
    const results = {};

    for (const id of uniqueIds) {
        const cacheKey = generateCacheKey(fetchFn, [id]);
        const cached = await getFromCache(cacheKey);

        if (cached) {
            console.log(`Cache hit for ${fetchFn.name}(${id})`);
            results[id] = cached;
            continue;
        }

        try {
            await rateLimit(); // Rate limit uncached requests
            const result = await fetchWithRetry(fetchFn, id);
            results[id] = result;
        } catch (error) {
            console.error(`Failed to fetch ${id}:`, error);
        }
    }

    return results;
}

app.post('*', async (req, res) => {
    console.log('post body', req.body);

    // Batch fetch all books first
    const bookResults = await batchFetchWithRetry(getBook, req.body);

    // Extract unique author IDs
    const authorIds = [...new Set(
        Object.values(bookResults)
            .filter(book => book?.author?.[0])
            .map(book => book.author[0].id)
    )];

    // Batch fetch all authors
    const authorResults = await batchFetchWithRetry(getAuthor, authorIds);

    // Format response
    const works = Object.values(bookResults).map(({ work }) => ({
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
});

const httpServer = http.createServer(app);
const httpsServer = https.createServer(credentials, app);

httpServer.listen(80, async () => {
    console.log('listening')
}
);
httpsServer.listen(443);

// app.listen(8816, async () => {
//     console.log('listening')
//     console.log(privateKey)
// })