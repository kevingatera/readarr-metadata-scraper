import * as cheerio from 'cheerio';
import { fetchWithTimeout } from './utils/fetch.js';
import { createLogger } from './logger.js';
const logger = createLogger('BOOK');

//Modified from https://github.com/nesaku/BiblioReads/blob/main/pages/api/book-scraper.js
export const getBook = async (id) => {
  logger.debug(`Starting fetch for book ID: ${id}`);
  try {
    const html = await fetchWithTimeout(`https://www.goodreads.com/book/show/${id}`);
    logger.debug(`Fetched HTML for book ID: ${id}`);

    const $ = cheerio.load(html);

    // Basic book info
    const cover = $(".ResponsiveImage").attr("src");
    const workURL = $('meta[property="og:url"]').attr("content");
    const title = $('h1[data-testid="bookTitle"]').text();

    logger.debug(`Parsed basic info for "${title}" (ID: ${id})`);

    // Author parsing with detailed logging
    const authorElements = $(".ContributorLinksList > span > a");
    logger.debug(`Found ${authorElements.length} author elements`);

    const author = authorElements
      .map((i, el) => {
        const $el = $(el);
        const name = $el.find("span").text();
        const url = $el.attr("href") || '';
        const id = url ? parseInt((url.substring(url.lastIndexOf('/') + 1)).split('.')[0]) : 0;

        logger.debug(`Parsed author: ${name}, ID: ${id}, URL: ${url}`);

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

    logger.debug(`Parsed metadata - Rating: ${rating}, Count: ${ratingCount}`);

    // Extract work ID from the quotes link
    const quotesLink = $('div.BookDiscussions__list a[href*="/work/quotes/"]').attr('href');
    const workIdMatch = quotesLink ? quotesLink.match(/\/work\/quotes\/(\d+)/) : null;
    const workId = workIdMatch ? workIdMatch[1] : null;

    logger.debug(`Extracted work ID: ${workId} for book ID: ${id}`);

    // Fetch all editions using the work ID
    let editions = [];
    if (workId) {
      try {
        editions = await getEditions(workId);
      } catch (error) {
        logger.error(`Error fetching editions for work ID ${workId}: ${error}`);
      }
    }

    // Construct the book object with editions
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
      Editions: editions,
    };

    logger.debug(`Constructed book object with editions for ID: ${id}`);
    return { work: realBook, author: author.length ? author : [{ id: 0, name: "Unknown Author", url: "" }] };

  } catch (error) {
    logger.error(`Error fetching/parsing book ${id}: ${error}`);
    throw new Error(`Failed to fetch book ${id}: ${error.message}`);
  }
};

export const getEditions = async (workId) => {
  logger.debug(`Starting fetch for editions of work ID: ${workId}`);
  try {
    const html = await fetchWithTimeout(`https://www.goodreads.com/work/editions/${workId}`);
    logger.debug(`Fetched HTML for work ID: ${workId}`);

    const $ = cheerio.load(html);
    const editions = [];

    $('div.elementList').each((index, element) => {
      const title = $(element).find('a.bookTitle').text().trim();
      const bookLink = $(element).find('a.bookTitle').attr('href');
      const bookIdMatch = bookLink.match(/\/book\/show\/(\d+)/);
      const bookId = bookIdMatch ? bookIdMatch[1] : null;

      const publicationDate = $(element).find('div.dataRow').eq(1).text().trim();
      const format = $(element).find('div.dataRow').eq(2).text().trim();

      const authors = [];
      $(element).find('div.moreDetails .authorName').each((i, authorElem) => {
        const authorName = $(authorElem).text().trim();
        authors.push(authorName);
      });

      const isbnMatch = $(element)
        .find('div.dataRow')
        .filter((i, el) => $(el).find('.dataTitle').text().trim() === 'ISBN:')
        .find('.dataValue')
        .text()
        .trim();
      const isbn = isbnMatch ? isbnMatch.split(' ')[0] : null;

      const asinMatch = $(element)
        .find('div.dataRow')
        .filter((i, el) => $(el).find('.dataTitle').text().trim() === 'ASIN:')
        .find('.dataValue')
        .text()
        .trim();
      const asin = asinMatch || null;

      const languageMatch = $(element)
        .find('div.dataRow')
        .filter((i, el) => $(el).find('.dataTitle').text().trim() === 'Edition language:')
        .find('.dataValue')
        .text()
        .trim();
      const editionLanguage = languageMatch || null;

      const ratingMatch = $(element)
        .find('div.dataRow')
        .filter((i, el) => $(el).find('.dataTitle').text().trim() === 'Average rating:')
        .find('.dataValue')
        .text()
        .trim();
      const averageRating = ratingMatch ? parseFloat(ratingMatch.split(' ')[0]) : null;

      editions.push({
        bookId,
        title,
        publicationDate,
        format,
        authors,
        isbn,
        asin,
        editionLanguage,
        averageRating,
      });
    });

    logger.debug(`Extracted ${editions.length} editions for work ID: ${workId}`);
    return editions;
  } catch (error) {
    logger.error(`Error fetching/parsing editions for work ${workId}: ${error}`);
    throw new Error(`Failed to fetch editions for work ${workId}: ${error.message}`);
  }
};

export default getBook;