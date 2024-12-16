import * as cheerio from 'cheerio';
import { fetchWithTimeout } from './utils/fetch.js';

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
    throw new Error(`Failed to fetch book ${id}: ${error.message}`);
  }
};

export default getBook;