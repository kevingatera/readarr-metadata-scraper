import * as cheerio from 'cheerio';
import { fetchWithTimeout } from './utils/fetch.js';
import { createLogger } from './logger.js';

const logger = createLogger('SERIES');

const parseSeriesPage = ($, seriesId) => {
  const title = $('.seriesDesc .bookTitle').first().text().trim();
  const url = `https://www.goodreads.com/series/${seriesId}`;
  
  // Get book count from the bookMeta span
  const bookCountText = $('.seriesDesc .bookMeta').first().text().trim();
  const bookCountMatch = bookCountText.match(/\((\d+)\s+books?\)/);
  const bookCount = bookCountMatch ? parseInt(bookCountMatch[1]) : 0;

  // Get rating info
  const ratingText = $('.seriesDesc .minirating').first().text().trim();
  const ratingMatch = ratingText.match(/(\d+\.\d+)\s+avg rating\s+—\s+([\d,]+)\s+ratings/);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
  const ratingCount = ratingMatch ? parseInt(ratingMatch[2].replace(/,/g, '')) : 0;

  // Get authors
  const authors = [];
  $('.seriesDesc .authorName__container').each((_, el) => {
    const $author = $(el).find('.authorName');
    const authorUrl = $author.attr('href') || '';
    const authorIdMatch = authorUrl.match(/\/author\/show\/(\d+)/);
    
    authors.push({
      ForeignId: authorIdMatch ? parseInt(authorIdMatch[1]) : 0,
      Name: $author.find('span[itemprop="name"]').text().trim()
    });
  });

  // Get books in series
  const books = [];
  $('.seriesCovers a').each((_, el) => {
    const $book = $(el);
    const bookUrl = $book.attr('href') || '';
    const bookIdMatch = bookUrl.match(/\/series\/\d+-([^?]+)/);
    if (bookIdMatch) {
      books.push({
        Title: $book.attr('title'),
        ForeignId: bookIdMatch[1]
      });
    }
  });

  logger.debug(`Parsed series: ${title} with ${bookCount} books`);

  return {
    ForeignId: parseInt(seriesId),
    Name: title,
    Url: url,
    WorkCount: bookCount,
    AverageRating: rating,
    RatingCount: ratingCount,
    Authors: authors,
    Books: books
  };
};

export const getSingleSeries = async (seriesId) => {
  logger.debug(`Starting fetch for series ID: ${seriesId}`);
  try {
    const html = await fetchWithTimeout(`https://www.goodreads.com/series/${seriesId}`);
    logger.debug(`Fetched HTML for series ID: ${seriesId}`);

    try {
      const $ = cheerio.load(html);
      const seriesResource = parseSeriesPage($, seriesId);
      logger.debug(`Constructed seriesResource for ID: ${seriesId}`);
      return seriesResource;
    } catch (parseError) {
      logger.error(`Error parsing series ${seriesId}: ${parseError}`);
      return null;
    }
  } catch (fetchError) {
    logger.error(`Error fetching series ${seriesId}: ${fetchError}`);
    throw fetchError;
  }
};

export default getSingleSeries; 