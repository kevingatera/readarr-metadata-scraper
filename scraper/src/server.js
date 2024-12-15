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

app.post('*', async (req, res) => {
    console.log('post body', req.body);
    const authors = {};
    const books = [];

    for (const id of req.body) {
        try {
            console.log('getting', id);
            const bookResult = await fetchWithRetry(getBook, id);
            console.log('retrieved book:', bookResult);

            if (!(bookResult.author[0].id in authors)) {
                const authorResult = await fetchWithRetry(getAuthor, bookResult.author[0].id, bookResult.author[0].url);
                authors[bookResult.author[0].id] = authorResult;
                console.log('retrieved author:', authorResult);
            }

            books.push(bookResult);
        } catch (error) {
            console.error(`Completely failed to fetch book ${id}:`, error.message);
        }
    }

    const works = books.map(({ work }) => ({
        ForeignId: work.ForeignId,
        Title: work.Title,
        Url: work.Url,
        Genres: ["horror"],
        RelatedWorks: [],
        Books: [work],
        Series: [],
    }));

    const response = {
        Works: works,
        Series: [],
        Authors: Object.values(authors)
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