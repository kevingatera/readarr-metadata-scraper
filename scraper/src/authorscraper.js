import * as cheerio from 'cheerio';
import { fetchWithTimeout } from './utils/fetch.js';

const getAuthor = async (authorId, authorUrl) => {
  console.log(`[AUTHOR] Starting fetch for author ID: ${authorId}, URL: ${authorUrl}`);

  try {
    const htmlString = await fetchWithTimeout(authorUrl);
    const $ = cheerio.load(htmlString);

    // Image parsing with logging
    const image = $(
      "div[itemtype = 'http://schema.org/Person'] > div > a > img"
    ).attr("src");
    console.log(`[AUTHOR] Parsed image: ${image || 'No image found'}`);

    // Name parsing
    const name = $("h1.authorName > span").text().trim();
    console.log(`[AUTHOR] Parsed name: ${name}`);

    // Optional fields with logging
    const website = $("div.dataItem > a[itemprop = 'url']").text().trim();
    console.log(`[AUTHOR] Parsed website: ${website || 'No website found'}`);

    const genre = $("div.dataItem > a[href*= '/genres/']")
      .map((i, el) => $(el).text())
      .get();
    console.log(`[AUTHOR] Parsed genres: ${genre.length} found`);

    // Description parsing
    const desc = $(".aboutAuthorInfo > span").html() || '';
    console.log(`[AUTHOR] Parsed description: ${desc ? 'Description found' : 'No description'}`);

    // Birth and death dates
    const birthDate = $(
      "div.rightContainer > div[itemprop = 'birthDate']"
    ).text().trim();
    const deathDate = $(
      "div.rightContainer > div[itemprop = 'deathDate']"
    ).text().trim();
    console.log(`[AUTHOR] Birth/Death dates - Birth: ${birthDate}, Death: ${deathDate}`);

    // Optional parsing of books and series (commented out for brevity, but you can add similar logging)
    const lastScraped = new Date().toISOString();

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

    console.log(`[AUTHOR] Successfully constructed author object for ID: ${authorId}`);
    return authorData;

  } catch (error) {
    console.error(`[AUTHOR] Error for author ${authorId}:`, error);
    throw new Error(`Failed to fetch author ${authorId}: ${error.message}`);
  }
};

export default getAuthor;