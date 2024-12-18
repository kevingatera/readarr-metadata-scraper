import * as cheerio from 'cheerio';
import { fetchWithTimeout } from './utils/fetch.js';
import { createLogger } from './logger.js';
const logger = createLogger('AUTHOR');

const parseBookFromList = ($, element) => {
  const $element = $(element);
  const titleElement = $element.find('.bookTitle');
  const title = titleElement.find('span[itemprop="name"]').text().trim();
  const url = titleElement.attr('href');
  const bookIdMatch = url.match(/show\/(\d+)/);
  const bookId = bookIdMatch ? parseInt(bookIdMatch[1]) : 0;

  const imageUrl = $element.find('img.bookCover').attr('src');
  
  const ratingText = $element.find('.minirating').text();
  const ratingMatch = ratingText.match(/(\d+\.\d+)\s+avg/);
  const averageRating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
  
  const ratingCountMatch = ratingText.match(/—\s*([\d,]+)\s+ratings/);
  const ratingCount = ratingCountMatch ? parseInt(ratingCountMatch[1].replace(/,/g, '')) : 0;

  return {
    ForeignId: bookId,
    Title: title,
    Url: `https://www.goodreads.com${url}`,
    ImageUrl: imageUrl,
    AverageRating: averageRating,
    RatingCount: ratingCount
  };
};

const parseAuthorPage = ($, authorId, authorUrl) => {
  const image = $("div[itemtype='http://schema.org/Person'] > div > a > img").attr("src") || '';
  logger.debug(`Parsed image: ${image ? image : 'No image found'}`);

  const name = $("h1.authorName > span").text().trim() || 'Unknown Author';
  logger.debug(`Parsed name: ${name}`);

  const desc = $(".aboutAuthorInfo span").first().html() || '';
  logger.debug(`Parsed description: ${desc ? 'Description found' : 'No description'}`);

  const averageRatingText = $('span.average').text() || '0';
  const averageRating = parseFloat(averageRatingText) || 0;

  const ratingCountText = $('span.votes').text().replace(/,/g, '') || '0';
  const ratingCount = parseInt(ratingCountText, 10) || 0;

  // Parse books from the list page
  const books = $('table.tableList tr[itemtype="http://schema.org/Book"]').map((i, element) => 
    parseBookFromList($, element)
  ).get();
  logger.debug(`Parsed ${books.length} books`);

  return {
    ForeignId: parseInt(authorId) || 0,
    ImageUrl: image,
    Name: name,
    Description: desc,
    RatingCount: ratingCount,
    AverageRating: averageRating,
    Url: authorUrl,
    Works: books
  };
};

const getAuthor = async (authorId, authorUrl) => {
  logger.debug(`Starting fetch for author ID: ${authorId}, URL: ${authorUrl}`);
  try {
    const htmlString = await fetchWithTimeout(authorUrl);
    try {
      const $ = cheerio.load(htmlString);
      const authorData = parseAuthorPage($, authorId, authorUrl);
      logger.debug(`Constructed author object for ID: ${authorId}`);
      return authorData;
    } catch (parseError) {
      logger.error(`Error parsing author ${authorId}: ${parseError}`);
      return null;
    }
  } catch (fetchError) {
    logger.error(`Error fetching author ${authorId}: ${fetchError}`);
    throw fetchError;
  }
};

export default getAuthor;