import * as cheerio from 'cheerio';

// Add at the top of bookscraper.js
const FETCH_TIMEOUT = 10000; // 10 seconds
const FETCH_OPTIONS = {
    timeout: FETCH_TIMEOUT,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
};

async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        const response = await fetch(url, {
            ...FETCH_OPTIONS,
            signal: controller.signal
        });
        return await response.text();
    } finally {
        clearTimeout(timeoutId);
    }
}

//Modified from https://github.com/nesaku/BiblioReads/blob/main/pages/api/book-scraper.js
export const getBook = async (id) => {
    console.log(`[BOOK] Starting fetch for book ID: ${id}`);
    try {
        const html = await fetchWithTimeout(`https://www.goodreads.com/book/show/${id}`);
        console.log(`[BOOK] Successfully fetched HTML for book ID: ${id}`);

        const $ = cheerio.load(html);

        // Basic book info
        const cover = $(".ResponsiveImage").attr("src");
        const workURL = $('meta[property="og:url"]').attr("content");
        const title = $('h1[data-testid="bookTitle"]').text();

        console.log(`[BOOK] Parsed basic info for "${title}" (ID: ${id})`);

        // Author parsing with detailed logging
        const authorElements = $(".ContributorLinksList > span > a");
        console.log(`[BOOK] Found ${authorElements.length} author elements`);

        const author = authorElements
            .map((i, el) => {
                const $el = $(el);
                const name = $el.find("span").text();
                const url = $el.attr("href") || '';
                const id = url ? parseInt((url.substring(url.lastIndexOf('/') + 1)).split('.')[0]) : 0;

                console.log(`[BOOK] Parsed author: ${name}, ID: ${id}, URL: ${url}`);

                return {
                    id: id || 0,
                    name: name || "Unknown Author",
                    url: url || "",
                };
            })
            .toArray();

        // Other metadata
        const rating = $("div.RatingStatistics__rating").text().slice(0, 4);
        const ratingCount = $('[data-testid="ratingsCount"]').text().split("rating")[0];
        const desc = $('[data-testid="description"]').text();
        const bookEdition = $('[data-testid="pagesFormat"]').text();
        const publishDate = $('[data-testid="publicationInfo"]').text();

        console.log(`[BOOK] Parsed metadata - Rating: ${rating}, Count: ${ratingCount}`);

        // Construct the book object
        const realBook = {
            Asin: "",
            AverageRating: parseFloat(rating) || 0,
            Contributors: author.length ? [{
                ForeignId: author[0]?.id || 0,
                Role: "Author"
            }] : [],
            Description: desc || "",
            EditionInformation: bookEdition || "",
            ForeignId: parseInt(id) || 0,
            Format: "",
            ImageUrl: cover || "",
            IsEbook: true,
            Isbn13: null,
            Language: "eng",
            NumPages: null,
            Publisher: "",
            RatingCount: parseInt(ratingCount) || 0,
            ReleaseDate: null,
            Title: title || `Unknown Book ${id}`,
            Url: workURL || `https://www.goodreads.com/book/show/${id}`,
        };

        console.log(`[BOOK] Successfully constructed book object for ID: ${id}`);
        return { work: realBook, author: author.length ? author : [{ id: 0, name: "Unknown Author", url: "" }] };

    } catch (error) {
        console.error(`[BOOK] Error fetching/parsing book ${id}:`, error);
        console.error(`[BOOK] Stack trace:`, error.stack);

        // Return fallback object
        return {
            work: {
                Asin: "",
                AverageRating: 0,
                Contributors: [],
                Description: `Failed to fetch book information: ${error.message}`,
                EditionInformation: "",
                ForeignId: parseInt(id),
                Format: "",
                ImageUrl: "",
                IsEbook: true,
                Isbn13: null,
                Language: "eng",
                NumPages: null,
                Publisher: "",
                RatingCount: 0,
                ReleaseDate: null,
                Title: `Failed to Load Book ${id}`,
                Url: `https://www.goodreads.com/book/show/${id}`,
            },
            author: [{ id: 0, name: "Unknown Author", url: "" }]
        };
    }
};

export default getBook;