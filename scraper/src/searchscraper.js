import { createLogger } from './logger.js';
import { fetchWithTimeout } from './utils/fetch.js';
import * as cheerio from 'cheerio';

const logger = createLogger('SEARCH');

/**
 * Search Goodreads for books by query string
 * @param {string} query - The search query
 * @returns {Promise<Array>} Array of search results with work IDs
 */
export async function searchGoodreads(query) {
  logger.info(`Searching Goodreads for: "${query}"`);

  const searchUrl = `https://www.goodreads.com/search?q=${encodeURIComponent(query)}`;
  logger.debug(`Search URL: ${searchUrl}`);

  const html = await fetchWithTimeout(searchUrl);
  const $ = cheerio.load(html);

  const results = [];

  // Parse search results from the page
  $('.tableList tr').each((index, element) => {
    try {
      const $row = $(element);

      // Get book title and URL
      const $titleLink = $row.find('.bookTitle');
      const bookUrl = $titleLink.attr('href');
      if (!bookUrl) return;

      // Extract book/work ID from URL (e.g., /book/show/123456 or /book/show/123456-title)
      const bookIdMatch = bookUrl.match(/\/book\/show\/(\d+)/);
      if (!bookIdMatch) return;

      const bookId = bookIdMatch[1];
      const title = $titleLink.find('span[itemprop="name"]').text().trim() || $titleLink.text().trim();

      // Get author
      const $authorLink = $row.find('.authorName');
      const authorName = $authorLink.find('span[itemprop="name"]').text().trim() || $authorLink.text().trim();
      const authorUrl = $authorLink.attr('href') || '';
      const authorIdMatch = authorUrl.match(/\/author\/show\/(\d+)/);
      const authorId = authorIdMatch ? authorIdMatch[1] : null;

      // Get cover image
      const imageUrl = $row.find('.bookCover').attr('src') || '';

      // Get rating
      const ratingText = $row.find('.minirating').text().trim();
      const avgRatingMatch = ratingText.match(/([\d.]+)\s+avg\s+rating/);
      const ratingsCountMatch = ratingText.match(/([\d,]+)\s+rating/);

      const avgRating = avgRatingMatch ? parseFloat(avgRatingMatch[1]) : 0;
      const ratingsCount = ratingsCountMatch ? parseInt(ratingsCountMatch[1].replace(/,/g, '')) : 0;

      results.push({
        qid: Math.random().toString(36).substring(7), // Simple random query ID
        workId: bookId,
        bookId: bookId,
        bookUrl: `https://www.goodreads.com${bookUrl}`,
        kcrPreviewUrl: null,
        title: title,
        bookTitleBare: title,
        description: {
          html: '',
          truncated: false,
          fullContentUrl: `https://www.goodreads.com${bookUrl}`
        },
        numPages: 0,
        avgRating: avgRating.toString(),
        ratingsCount: ratingsCount,
        imageUrl: imageUrl,
        author: {
          id: parseInt(authorId) || 0,
          name: authorName,
          isGoodreadsAuthor: true,
          profileUrl: authorUrl ? `https://www.goodreads.com${authorUrl}` : '',
          worksListUrl: authorUrl ? `https://www.goodreads.com${authorUrl}` : ''
        },
        from_search: true,
        from_srp: true,
        rank: index + 1
      });

      logger.debug(`Parsed search result ${index + 1}: ${title} by ${authorName} (ID: ${bookId})`);
    } catch (error) {
      logger.warn(`Error parsing search result ${index}:`, error.message);
    }
  });

  logger.info(`Found ${results.length} search results for "${query}"`);
  return results;
}
