import * as cheerio from 'cheerio';
import { fetchWithTimeout } from './utils/fetch.js';
import { createLogger } from './logger.js';
const logger = createLogger('AUTHOR');

const getAuthor = async (authorId, authorUrl) => {
  logger.debug(`Starting fetch for author ID: ${authorId}, URL: ${authorUrl}`);

  try {
    const htmlString = await fetchWithTimeout(authorUrl);
    const $ = cheerio.load(htmlString);

    const image = $("div[itemtype='http://schema.org/Person'] > div > a > img").attr("src");
    logger.debug(`Parsed image: ${image || 'No image found'}`);

    const name = $("h1.authorName > span").text().trim();
    logger.debug(`Parsed name: ${name}`);

    const website = $("div.dataItem > a[itemprop='url']").text().trim();
    logger.debug(`Parsed website: ${website || 'No website found'}`);

    const genre = $("div.dataItem > a[href*='/genres/']")
      .map((i, el) => $(el).text())
      .get();
    logger.debug(`Parsed genres: ${genre.length} found`);

    const desc = $(".aboutAuthorInfo > span").html() || '';
    logger.debug(`Parsed description: ${desc ? 'Description found' : 'No description'}`);

    const birthDate = $("div.rightContainer > div[itemprop='birthDate']").text().trim();
    const deathDate = $("div.rightContainer > div[itemprop='deathDate']").text().trim();
    logger.debug(`Birth/Death dates - Birth: ${birthDate}, Death: ${deathDate}`);

    const authorData = {
      AverageRating: 3.0,
      Description: desc,
      ForeignId: parseInt(authorId),
      ImageUrl: image || '',
      Name: name || 'Unknown Author',
      RatingCount: 120,
      Series: null,
      Url: authorUrl,
      Works: null
    };

    logger.debug(`Constructed author object for ID: ${authorId}`);
    return authorData;

  } catch (error) {
    logger.error(`Error for author ${authorId}: ${error}`);
    throw new Error(`Failed to fetch author ${authorId}: ${error.message}`);
  }
};

export default getAuthor;