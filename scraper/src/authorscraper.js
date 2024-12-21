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

const parseSeriesPage = async (seriesUrl) => {
  try {
    const html = await fetchWithTimeout(seriesUrl);

    const books = parseWorksFromSeriesListPage(html);

    logger.debug(`Parsed ${books.length} books from series page`);
    return books;
  } catch (error) {
    logger.error(`Error scraping series page ${seriesUrl}: ${error.message}`);
    return [];
  }
};

const parseSeriesFromPage = async ($) => {
  const seriesElements = $('div.bookRow.seriesBookRow');
  const series = [];

  for (let i = 0; i < seriesElements.length; i++) {
    const $seriesElement = $(seriesElements[i]);

    // Find series title link
    const seriesTitleElement = $seriesElement.find('.seriesDesc .bookTitle');
    const seriesTitle = seriesTitleElement.text().trim();
    const seriesUrl = seriesTitleElement.attr('href');

    const seriesIdMatch = seriesUrl ? seriesUrl.match(/series\/(\d+)/) : null;
    const seriesId = seriesIdMatch ? parseInt(seriesIdMatch[1]) : 0;

    if (seriesUrl) {
      const fullSeriesUrl = `https://www.goodreads.com${seriesUrl}`;
      const works = await parseSeriesPage(fullSeriesUrl);

      series.push({
        ForeignId: seriesId,
        Title: seriesTitle,
        Url: fullSeriesUrl,
        Works: works
      });
    }
  }

  logger.debug(`Parsed ${series.length} series with their works`);
  return series;
};

const parseAuthorPage = async ($, authorId, authorUrl) => {
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

  // Add series to the return object
  const series = await parseSeriesFromPage($);

  // Aggregate works from all series
  const allWorks = series.flatMap(s => s.Works);

  return {
    ForeignId: parseInt(authorId) || 0,
    ImageUrl: image,
    Name: name,
    Description: desc,
    RatingCount: ratingCount,
    AverageRating: averageRating,
    Url: authorUrl,
    Works: allWorks,
    Series: series,
  };
};

const getAuthor = async (authorId, authorUrl) => {
  logger.debug(`Starting fetch for author ID: ${authorId}, URL: ${authorUrl}`);
  try {
    const html = await fetchWithTimeout(authorUrl);

    const $ = cheerio.load(html);

    const authorData = await parseAuthorPage($, authorId, authorUrl);
    logger.debug(`Constructed author object for ID: ${authorId}`);
    return authorData;
  } catch (fetchError) {
    logger.error(`Error fetching author ${authorId}: ${fetchError.message}`);
    throw fetchError;
  }
};

export function parseWorksFromSeriesListPage(html) {
  console.debug('Parsing series list page...')
  const $ = cheerio.load(html)

  const books = []

  $('.responsiveBook').each((i, el) => {
    const $book = $(el)
    const bookHtml = $book.html()
    // console.log(bookHtml)

    const bookLink = $book.find('a.gr-h3').first()
    const bookUrl = bookLink.attr('href')
    const bookId = bookLink.attr('href')?.match(/show\/(\d+)/)?.[1]

    // Extract image URL
    const imageUrl = $book.find('img.responsiveBook__img').attr('src')

    // Extract ratings data
    const rating = $book.find('.communityRating__stars').attr('aria-label')?.match(/[\d.]+/)?.[0]
    const ratingsCount = $book.find('.gr-metaText:contains("Ratings")').text().match(/[\d,]+/)?.[0]?.replace(/,/g, '')
    const reviewsCount = $book.find('.gr-metaText:contains("Reviews")').text().match(/[\d,]+/)?.[0]?.replace(/,/g, '')

    // Extract author info
    const authorLink = $book.find('a[href*="/author/"]')
    const authorUrl = authorLink.attr('href')
    const authorId = authorUrl?.match(/\/author\/show\/(\d+)/)?.[1]

    // Extract description
    const description = $book.find('.expandableHtml span').first().text()

    // Find related books in the same series or by the same author
    const relatedBooks = $('.responsiveBook')
      .filter((index, relatedEl) => {
        // Exclude the current book
        if (relatedEl === el) return false;

        // Find related books in the same series or by the same author
        const relatedAuthorLink = $(relatedEl).find('a[href*="/author/"]');
        const relatedAuthorId = relatedAuthorLink.attr('href')?.match(/\/author\/show\/(\d+)/)?.[1];

        return relatedAuthorId === authorId;
      })
      .map((index, relatedEl) => {
        const $relatedBook = $(relatedEl);
        const relatedBookLink = $relatedBook.find('a.gr-h3').first();
        const relatedBookUrl = relatedBookLink.attr('href');
        const relatedBookId = relatedBookUrl?.match(/show\/(\d+)/)?.[1]

        return {
          ForeignId: parseInt(relatedBookId) || 0,
          Title: relatedBookLink.text().trim(),
          Url: relatedBookUrl ? `https://www.goodreads.com${relatedBookUrl}` : null
        };
      })
      .get();

    // Determine series based on context
    const seriesTitle = $book.find('.gr-metaText:contains("Series")').text().replace('Series', '').trim();
    const series = seriesTitle ? [{
      Title: seriesTitle,
      Works: relatedBooks
    }] : [];

    books.push({
      ForeignId: parseInt(bookId) || 0,
      Title: bookLink.text().trim(),
      Url: bookUrl ? `https://www.goodreads.com${bookUrl}` : null,
      ImageUrl: imageUrl,
      AverageRating: rating ? parseFloat(rating) : null,
      RatingCount: ratingsCount ? parseInt(ratingsCount) : 0,
      ReviewCount: reviewsCount ? parseInt(reviewsCount) : 0,
      Description: description,
      ReleaseDate: $book.find('.gr-metaText:contains("published")').text().replace('published ', '').trim(),
      Authors: authorId ? [{
        ForeignId: parseInt(authorId),
        Name: authorLink.text().trim(),
        Url: authorUrl ? `https://www.goodreads.com${authorUrl}` : null
      }] : [],
      Series: series,
      Books: relatedBooks, // Books in the same series or by the same author
      Genres: [], // Would need separate request to get genres
      RelatedWorks: relatedBooks // Same as Books for now
    })
  })

  return books
}

export default getAuthor;