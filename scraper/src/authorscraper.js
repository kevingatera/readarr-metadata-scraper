import * as cheerio from 'cheerio';
import { fetchWithTimeout } from './utils/fetch.js';
import { createLogger } from './logger.js';
const logger = createLogger('AUTHOR');

const getAuthor = async (authorId, authorUrl) => {
  logger.debug(`Starting fetch for author ID: ${authorId}, URL: ${authorUrl}`);

  try {
    const htmlString = await fetchWithTimeout(authorUrl);
    const $ = cheerio.load(htmlString);

    const image = $("div[itemtype='http://schema.org/Person'] > div > a > img").attr("src") || '';
    logger.debug(`Parsed image: ${image ? image : 'No image found'}`);

    const name = $("h1.authorName > span").text().trim() || 'Unknown Author';
    logger.debug(`Parsed name: ${name}`);

    const genres = $('div.dataItem a[href*="/genres/"]')
      .map((i, el) => $(el).text().trim())
      .get();

    logger.debug(`Parsed genres: ${genres.length} found`);

    const desc = $(".aboutAuthorInfo span").first().html() || '';
    logger.debug(`Parsed description: ${desc ? 'Description found' : 'No description'}`);

    const averageRatingText = $('span.average').text() || '0';
    const averageRating = parseFloat(averageRatingText) || 0;

    const ratingCountText = $('span.votes').text().replace(/,/g, '') || '0';
    const ratingCount = parseInt(ratingCountText, 10) || 0;

    const series = $('.bookRow.seriesBookRow').map((i, seriesElement) => {
      const seriesNameElement = $(seriesElement).find('span[itemprop="name"] a.bookTitle');
      const seriesName = seriesNameElement.text().trim();
      const seriesUrl = seriesNameElement.attr('href') || '';
      const seriesIdMatch = seriesUrl.match(/\/series\/(\d+)/);
      const seriesId = seriesIdMatch ? parseInt(seriesIdMatch[1]) : 0;

      const bookCountText = $(seriesElement).find('.bookMeta').text().trim();
      const bookCountMatch = bookCountText.match(/\((\d+)\s+books?\)/);
      const bookCount = bookCountMatch ? parseInt(bookCountMatch[1]) : 0;

      return {
        ForeignId: seriesId,
        Name: seriesName,
        Url: `https://www.goodreads.com${seriesUrl}`,
        BookCount: bookCount
      };
    }).get();

    logger.debug(`Parsed ${series.length} series`);

    const authorData = {
      AverageRating: averageRating,
      Description: desc,
      ForeignId: parseInt(authorId) || 0,
      ImageUrl: image,
      Name: name,
      RatingCount: ratingCount,
      Series: series.length > 0 ? series : null,
      Url: authorUrl,
      Works: null,
      Genres: genres,
    };

    logger.debug(`Constructed author object for ID: ${authorId}`);
    return authorData;
  } catch (error) {
    logger.error(`Error for author ${authorId}: ${error}`);
    throw new Error(`Failed to fetch author ${authorId}: ${error.message}`);
  }
};

export default getAuthor;