import * as cheerio from 'cheerio';
import { fetchWithTimeout } from './utils/fetch.js';
import { createLogger } from './logger.js';
const logger = createLogger('BOOK');

const extractGenres = ($) => {
  const genreElements = $('.BookPageMetadataSection__genreButton a.Button--tag');
  const genres = genreElements.map((_, element) => $(element).text().trim()).get();

  logger.debug(`Extracted genres: ${genres.join(', ')}`);
  return genres;
};

const parseSeriesPage = ($, id) => {
  const seriesLink = $('h3.Text__title3.Text__italic a');
  if (seriesLink.length === 0) {
    return null;
  }

  const seriesText = seriesLink.text().trim();
  const seriesUrl = seriesLink.attr('href') || '';
  const seriesMatch = seriesText.match(/(.*?)(?:\s+#(\d+))?$/);
  const seriesIdMatch = seriesUrl.match(/\/series\/(\d+)/);

  if (!seriesMatch || !seriesIdMatch) {
    return null;
  }

  const seriesId = parseInt(seriesIdMatch[1]);
  const position = seriesMatch[2] ? parseInt(seriesMatch[2]) : 0;
  const title = seriesMatch[1].trim();

  return {
    ForeignId: seriesId,
    Title: title,
    Url: seriesUrl,
    Description: '',
    LinkItems: [{
      ForeignWorkId: parseInt(id),
      PositionInSeries: position.toString(),
      SeriesPosition: position,
      Primary: true
    }]
  };
};

const parseBookPage = ($, id) => {
  const cover = $(".ResponsiveImage").attr("src") || "";
  const workURL = $('meta[property="og:url"]').attr("content") || `https://www.goodreads.com/book/show/${id}`;
  const title = $('h1[data-testid="bookTitle"]').text().trim() || `Unknown Book ${id}`;
  const imageUrl = $(".ResponsiveImage").attr("src") || "";
  const bookUrl = $('meta[property="og:url"]').attr("content") || `https://www.goodreads.com/book/show/${id}`;
  const description = $('[data-testid="description"]').text().trim() || '';

  let isbn13 = null;
  let asin = null;
  const detailsRows = $('div[data-testid="bookDetails"] > div');

  detailsRows.each((i, el) => {
    const label = $(el).find('span').first().text().trim();
    const value = $(el).find('span').last().text().trim();

    if (label.includes('ISBN13')) {
      const isbnMatch = value.match(/(\d{13})/);
      if (isbnMatch) {
        isbn13 = isbnMatch[1];
      }
    }

    if (label.includes('ASIN')) {
      asin = value;
    }
  });

  const format = $('div[data-testid="bookFormat"]').text().trim();
  const numPagesText = $('p[data-testid="pagesFormat"]').text().trim();
  const numPagesMatch = numPagesText.match(/(\d+) pages/);
  const numPages = numPagesMatch ? parseInt(numPagesMatch[1]) : null;

  const publisherText = $('p[data-testid="publicationInfo"]').text().trim();
  const publisherMatch = publisherText.match(/Published\s+.*\s+by\s+(.*)/);
  const publisher = publisherMatch ? publisherMatch[1] : '';

  const releaseDateMatch = publisherText.match(/Published\s+(.*)\s+by/);
  const releaseDate = releaseDateMatch ? releaseDateMatch[1] : null;

  const language = 'eng';

  const rating = parseFloat($("div.RatingStatistics__rating").text()) || 0;
  const ratingCountText = $('[data-testid="ratingsCount"]').text();
  const ratingCountMatch = ratingCountText.match(/([\d,]+)\s+ratings/);
  const ratingCount = ratingCountMatch ? parseInt(ratingCountMatch[1].replace(/,/g, ''), 10) : 0;

  const authorElements = $(".ContributorLinksList > span > a");

  const authors = authorElements
    .map((i, el) => {
      const $el = $(el);
      const name = $el.find("span").text().trim() || "Unknown Author";
      const url = $el.attr("href") || '';
      const foreignId = url ? parseInt(url.split('/').pop()) : 0;

      logger.debug(`Parsed author: ${name}, ForeignId: ${foreignId}, URL: ${url}`);

      return {
        ForeignId: foreignId || 0,
        Name: name,
        Url: url || "",
        Series: null,
        Works: null
      };
    })
    .toArray();

  const contributors = authors.map(author => ({
    ForeignId: author.ForeignId,
    Role: "Author"
  }));

  const seriesElement = $('h3.Text__title3.Text__italic');
  let series = null;

  if (seriesElement.length > 0) {
    const seriesData = parseSeriesPage($, id);
    if (seriesData) {
      series = [seriesData];
      logger.debug(`Parsed series: ${seriesData.Title} #${seriesData.LinkItems[0].SeriesPosition} (ID: ${seriesData.ForeignId})`);
    }
  }

  return {
    Asin: asin,
    AverageRating: rating,
    Contributors: contributors,
    Description: description,
    EditionInformation: format,
    ForeignId: parseInt(id) || 0,
    Format: format,
    ImageUrl: imageUrl,
    IsEbook: format.toLowerCase().includes('kindle') || format.toLowerCase().includes('ebook'),
    Isbn13: isbn13,
    Language: language,
    NumPages: numPages,
    Publisher: publisher,
    RatingCount: ratingCount,
    ReleaseDate: releaseDate,
    Title: title,
    Url: bookUrl,
    Genres: extractGenres($),
    Series: series || [],
  };
};

export const getBook = async (id) => {
  logger.debug(`Starting fetch for book ID: ${id}`);
  try {
    const html = await fetchWithTimeout(`https://www.goodreads.com/book/show/${id}`);
    logger.debug(`Fetched HTML for book ID: ${id}`);

    try {
      const $ = cheerio.load(html);
      const bookResource = parseBookPage($, id);
      logger.debug(`Constructed bookResource for ID: ${id}`);
      return bookResource;
    } catch (parseError) {
      logger.error(`Error parsing book ${id}: ${parseError}`);
      return null;
    }
  } catch (fetchError) {
    logger.error(`Error fetching book ${id}: ${fetchError}`);
    throw fetchError;
  }
};

const parsePublicationDate = (dateStr) => {
  const cleanDate = dateStr
    .replace(/\n.*$/, '')  // Remove everything after newline
    .replace(/Published\s+/, '')  // Remove 'Published' prefix
    .replace(/(st|nd|rd|th),?/g, '')  // Remove ordinal indicators
    .trim();

  try {
    const date = new Date(cleanDate);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  } catch (error) {
    return null;
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
      const title = $(element).find('a.bookTitle').text().trim() || 'Unknown Title';
      let series = null;
      const seriesMatch = title.match(/(.*?)\s*\((.*?)\s*#(\d+)\)/);

      if (seriesMatch && seriesMatch[2] && seriesMatch[3]) {
        series = [{
          ForeignId: 0,
          Name: seriesMatch[2].trim(),
          Position: parseInt(seriesMatch[3]),
          Url: ''
        }];
        logger.debug(`Parsed edition series: ${series[0].Name} #${series[0].Position}`);
      }

      const bookLink = $(element).find('a.bookTitle').attr('href') || '';
      const bookIdMatch = bookLink.match(/\/book\/show\/(\d+)/);
      const bookId = bookIdMatch ? bookIdMatch[1] : null;

      const publicationInfo = $(element).find('div.dataRow').eq(1).text().trim() || '';
      const publicationDate = parsePublicationDate(publicationInfo);

      const publisherMatch = publicationInfo.match(/by\s+(.*)/);
      const publisher = publisherMatch ? publisherMatch[1].trim() : '';

      const formatAndPagesText = $(element).find('div.dataRow').eq(2).text().trim() || '';
      const numPagesMatch = formatAndPagesText.match(/(\d+)\s*pages/);
      const numPages = numPagesMatch ? parseInt(numPagesMatch[1]) : null;
      const format = formatAndPagesText.split(',')[0].trim();

      const authors = [];
      $(element).find('div.authorName__container').each((i, authorContainer) => {
        const authorLink = $(authorContainer).find('a.authorName');
        const authorName = authorLink.find('span[itemprop="name"]').text().trim() || "Unknown Author";
        const authorUrl = authorLink.attr('href') || '';
        const authorIdMatch = authorUrl.match(/\/author\/show\/(\d+)/);
        const authorId = authorIdMatch ? parseInt(authorIdMatch[1]) : 0;

        const roleElement = $(authorContainer).find('.greyText.role, .greyText');
        const roleText = roleElement.text().replace(/[()]/g, '').trim();
        const role = roleText.includes('Author') ? 'Author' : (roleText || 'Author');

        authors.push({
          name: authorName,
          foreignId: authorId,
          url: authorUrl,
          role: role
        });
      });

      const contributors = authors.map(author => ({
        ForeignId: author.foreignId,
        Role: author.role,
        Name: author.name,
        Url: author.url
      }));

      const isbn = $(element)
        .find('.dataRow')
        .filter((i, el) => $(el).find('.dataTitle').text().trim() === 'ISBN:')
        .find('.dataValue')
        .text()
        .trim() || null;

      const asin = $(element)
        .find('.dataRow')
        .filter((i, el) => $(el).find('.dataTitle').text().trim() === 'ASIN:')
        .find('.dataValue')
        .text()
        .trim() || null;

      const editionLanguage = $(element)
        .find('.dataRow')
        .filter((i, el) => $(el).find('.dataTitle').text().trim() === 'Edition language:')
        .find('.dataValue')
        .text()
        .trim() || 'eng';

      const averageRatingText = $(element)
        .find('.dataRow')
        .filter((i, el) => $(el).find('.dataTitle').text().trim() === 'Average rating:')
        .find('.dataValue')
        .text()
        .trim()
        .split(' ')[0];

      const averageRating = parseFloat(averageRatingText) || 0;

      const ratingCountMatch = $(element)
        .find('.dataRow')
        .filter((i, el) => $(el).find('.dataTitle').text().trim() === 'Average rating:')
        .find('.greyText')
        .text()
        .match(/\(([\d,]+) ratings\)/);

      const ratingCount = ratingCountMatch ? parseInt(ratingCountMatch[1].replace(/,/g, ''), 10) : 0;

      const imageUrl = $(element).find('div.leftAlignedImage img').attr('src') || '';

      editions.push({
        Asin: asin,
        AverageRating: averageRating,
        Contributors: contributors,
        Description: '',
        EditionInformation: format,
        ForeignId: parseInt(bookId) || 0,
        Format: format,
        ImageUrl: imageUrl,
        IsEbook: format.toLowerCase().includes('ebook') || format.toLowerCase().includes('kindle'),
        Isbn13: isbn || null,
        Language: editionLanguage,
        NumPages: numPages,
        Publisher: publisher,
        RatingCount: ratingCount,
        ReleaseDate: publicationDate || null,
        Title: title,
        Url: `https://www.goodreads.com/book/show/${bookId}`,
        Series: series || [],
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