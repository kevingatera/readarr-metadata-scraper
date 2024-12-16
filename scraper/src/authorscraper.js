import * as cheerio from 'cheerio';

const FETCH_TIMEOUT = 10000; // 10 seconds

async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    
    try {
        console.log(`[AUTHOR FETCH] Attempting to fetch URL: ${url}`);
        const response = await fetch(url, {
            method: "GET",
            headers: new Headers({
                "User-Agent": process.env.NEXT_PUBLIC_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
            }),
            signal: controller.signal
        });
        console.log(`[AUTHOR FETCH] Successfully fetched URL: ${url}`);
        return await response.text();
    } catch (error) {
        console.error(`[AUTHOR FETCH] Error fetching URL ${url}:`, error.message);
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

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
        console.error(`[AUTHOR] Comprehensive error for author ${authorId}:`, {
            message: error.message,
            stack: error.stack,
            url: authorUrl
        });
        
        // Return a fallback object
        return {
            AverageRating: 0,
            Description: `Failed to fetch author information: ${error.message}`,
            ForeignId: parseInt(authorId),
            ImageUrl: '',
            Name: 'Failed to Load Author',
            RatingCount: 0,
            Series: null,
            Url: authorUrl,
            Works: null
        };
    }
};

export default getAuthor;