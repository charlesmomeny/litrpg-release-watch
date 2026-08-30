/**
 * Scraper - fetches and parses Audible/Amazon pages
 * Supports both lightweight fetch mode and fallback tab-based scraping
 */
import { AudibleParser } from './parsers/audible.js';
import { AmazonParser } from './parsers/amazon.js';
export class Scraper {
    /**
     * Scrape Audible search results
     */
    static async scrapeAudible(url, settings) {
        return this.scrape(url, 'audible', settings);
    }
    /**
     * Scrape Amazon series page
     */
    static async scrapeAmazon(url, settings) {
        return this.scrape(url, 'amazon', settings);
    }
    /**
     * Main scrape method with fallback logic
     */
    static async scrape(url, source, settings) {
        const failureKey = `${source}_${url}`;
        const failures = this.failureCounts.get(failureKey) || 0;
        // OPTIMIZATION: Audible's bot detection blocks fetch mode reliably.
        // Skip the wasted fetch attempt and go straight to fallback (tab-based) mode.
        if (source === 'audible' && settings.fallbackScrapeEnabled) {
            return this.fallbackMode(url, source, settings);
        }
        // Try fetch mode first (unless we've had repeated failures)
        if (failures < 3) {
            const fetchResult = await this.fetchMode(url, source, settings);
            if (fetchResult.items.length > 0 || !fetchResult.error) {
                // Success - reset failure count
                this.failureCounts.set(failureKey, 0);
                return fetchResult;
            }
            // Fetch failed
            this.failureCounts.set(failureKey, failures + 1);
            // If bot detection, DOMParser missing, or empty results, try fallback if enabled
            if (settings.fallbackScrapeEnabled &&
                (fetchResult.error?.includes('Bot detection') ||
                    fetchResult.error?.includes('CAPTCHA') ||
                    fetchResult.error?.includes('DOMParser is not defined'))) {
                console.log(`Fetch mode failed for ${source}, trying fallback mode...`);
                return this.fallbackMode(url, source, settings);
            }
            return fetchResult;
        }
        // Multiple failures - use fallback mode if enabled
        if (settings.fallbackScrapeEnabled) {
            return this.fallbackMode(url, source, settings);
        }
        return {
            items: [],
            error: 'Multiple fetch failures, fallback mode disabled'
        };
    }
    /**
     * Fetch mode - background fetch with DOMParser
     */
    static async fetchMode(url, source, settings) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Cache-Control': 'no-cache'
                }
            });
            if (!response.ok) {
                return {
                    items: [],
                    error: `HTTP ${response.status}: ${response.statusText}`
                };
            }
            const html = await response.text();
            // Parse based on source
            if (source === 'audible') {
                return AudibleParser.parse(html, settings.maxResultsPerSource);
            }
            else {
                return AmazonParser.parse(html, settings.maxResultsPerSource);
            }
        }
        catch (e) {
            return {
                items: [],
                error: `Fetch error: ${e.message || String(e)}`
            };
        }
    }
    /**
     * Fallback mode - open tab, inject content script, extract data
     */
    static async fallbackMode(url, source, settings) {
        let tabId = null;
        try {
            // Check if we have tabs permission
            const hasPermission = await chrome.permissions.contains({
                permissions: ['tabs', 'scripting']
            });
            if (!hasPermission) {
                return {
                    items: [],
                    error: 'Fallback mode requires tabs and scripting permissions'
                };
            }
            // Create inactive tab
            const tab = await chrome.tabs.create({
                url,
                active: false
            });
            tabId = tab.id;
            // Wait for page to load
            await this.waitForTabLoad(tabId);
            // Inject and execute scraper - must use inline function, not class method reference
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: (source, maxResults) => {
                    // This function runs in page context - must be self-contained
                    // Word-to-number conversion (copied from utils.js)
                    function wordToNumber(word) {
                        const words = {
                            'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
                            'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
                            'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
                            'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20
                        };
                        return words[word.toLowerCase()] || null;
                    }
                    // Extract book number (copied from utils.js)
                    function extractBookNumber(title) {
                        if (!title)
                            return undefined;
                        const patterns = [
                            // "Book 12", "Book Twelve"
                            /\bBook\s+(\d+|[A-Z][a-z]+)\b/i,
                            // "#12", "# 12"
                            /#\s*(\d+)/,
                            // "Volume 12", "Vol 12", "Vol. 12"
                            /\bVol(?:ume)?\.?\s+(\d+|[A-Z][a-z]+)\b/i,
                            // "Part 12"
                            /\bPart\s+(\d+|[A-Z][a-z]+)\b/i,
                            // ": 12", " - 12" at end
                            /[:\-]\s*(\d+)\s*$/,
                            // "Title 5: Subtitle" — number before subtitle separator
                            /\s(\d{1,2})\s*[:\-]\s+\S/,
                            // "Title 3" (space + 1-2 digits at end)
                            /\s(\d{1,2})$/,
                        ];
                        for (const pattern of patterns) {
                            const match = title.match(pattern);
                            if (match) {
                                const value = match[1];
                                // Try to convert to number
                                const num = parseInt(value);
                                if (!isNaN(num)) {
                                    return num;
                                }
                                // Try word-to-number conversion
                                const wordNum = wordToNumber(value);
                                if (wordNum !== null) {
                                    return wordNum;
                                }
                            }
                        }
                        return undefined;
                    }
                    // Extract author
                    function extractAuthor(container) {
                        const selectors = [
                            'a[href*="/author/"]',
                            '.authorLabel a',
                            '.authorLabel',
                        ];
                        for (const selector of selectors) {
                            const elements = Array.from(container.querySelectorAll(selector));
                            for (const element of elements) {
                                let text = element.textContent?.trim() || '';
                                if (!text || text.length < 2)
                                    continue;
                                // Clean up
                                text = text.replace(/^(?:by|written by)[:\s]*/i, '').trim();
                                text = text.replace(/\s+/g, ' ').trim();
                                // Valid author
                                if (text.length > 2 && text.length < 100 &&
                                    !text.toLowerCase().includes('narrator') &&
                                    !text.toLowerCase().includes('narrated') &&
                                    !text.toLowerCase().includes('series')) {
                                    return text;
                                }
                            }
                        }
                        return null;
                    }
                    if (source === 'audible') {
                        const items = [];
                        const containers = document.querySelectorAll('li.productListItem');
                        for (let i = 0; i < Math.min(containers.length, maxResults); i++) {
                            const container = containers[i];
                            // Extract title and URL
                            const titleEl = container.querySelector('h3 a, .bc-heading a, h3.bc-heading a');
                            const title = titleEl?.textContent?.trim();
                            const url = titleEl?.href;
                            if (!title || !url)
                                continue;
                            // Extract book number using proper function
                            const bookNumber = extractBookNumber(title);
                            // Extract author
                            const author = extractAuthor(container);
                            // Extract release date (e.g., "Release date: 03-03-26")
                            let releaseDateRaw = null;
                            const containerText = container.textContent || '';
                            const dateMatch = containerText.match(/Release date:\s*([^\n]+)/i);
                            if (dateMatch) {
                                releaseDateRaw = dateMatch[1].trim();
                            }
                            // Extract availability from buttons
                            let availability = 'unknown';
                            const containerLower = containerText.toLowerCase();
                            if (containerLower.includes('pre-order') || containerLower.includes('preorder')) {
                                availability = 'preorder';
                            }
                            else if (containerLower.includes('play') ||
                                containerLower.includes('add to cart') ||
                                containerLower.includes('buy now') ||
                                containerLower.includes('in your library')) {
                                availability = 'available';
                            }
                            items.push({
                                title,
                                url: url.split('?')[0],
                                releaseDate: releaseDateRaw,
                                releaseDateRaw,
                                availability,
                                source: 'audible',
                                bookNumber,
                                author: author || undefined
                            });
                        }
                        return { items };
                    }
                    else {
                        // Amazon
                        const items = [];
                        const containers = document.querySelectorAll('[data-asin]:not([data-asin=""])');
                        for (let i = 0; i < Math.min(containers.length, maxResults); i++) {
                            const container = containers[i];
                            const titleEl = container.querySelector('h2 a, .s-line-clamp-2');
                            const title = titleEl?.textContent?.trim();
                            const url = titleEl?.href;
                            if (title && url) {
                                items.push({
                                    title,
                                    url: url.split('?')[0],
                                    releaseDate: null,
                                    releaseDateRaw: null,
                                    availability: 'unknown',
                                    source: 'amazon'
                                });
                            }
                        }
                        return { items };
                    }
                },
                args: [source, settings.maxResultsPerSource || 20]
            });
            const result = results[0]?.result;
            // Close tab
            await chrome.tabs.remove(tabId);
            tabId = null;
            return result || { items: [], error: 'No data extracted' };
        }
        catch (e) {
            // Clean up tab if it exists
            if (tabId) {
                try {
                    await chrome.tabs.remove(tabId);
                }
                catch (cleanupError) {
                    // Ignore cleanup errors
                }
            }
            return {
                items: [],
                error: `Fallback mode error: ${e.message || String(e)}`
            };
        }
    }
    /**
     * Wait for tab to finish loading
     */
    static waitForTabLoad(tabId) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Tab load timeout'));
            }, 30000); // 30 second timeout
            const listener = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    clearTimeout(timeout);
                    chrome.tabs.onUpdated.removeListener(listener);
                    // Give page extra time to render
                    setTimeout(resolve, 2000);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    }
    /**
     * Function to be injected into page (runs in page context)
     * This must be completely self-contained with no external dependencies
     */
    static extractPageData(source, maxResults) {
        // This function runs in the page context, so it can't import modules
        // Define extraction functions FIRST (before calling them)
        // Inline Audible extractor
        function extractAudibleData(max) {
            const items = [];
            // Use specific selector that gets ~20 search results, not 1000+ navigation items
            const containers = document.querySelectorAll('li.productListItem');
            for (let i = 0; i < Math.min(containers.length, max); i++) {
                const container = containers[i];
                // Extract title
                const titleEl = container.querySelector('h3 a, .bc-heading a, h3.bc-heading a');
                const title = titleEl?.textContent?.trim();
                const url = titleEl?.href;
                if (!title || !url)
                    continue;
                // Extract book number from series field (e.g., "Series: Spellmonger, Book 18")
                let bookNumber = null;
                const seriesText = container.textContent || '';
                const seriesMatch = seriesText.match(/Series:[^\n]*Book\s+(\d+)/i) ||
                    seriesText.match(/,\s*Book\s+(\d+)/i);
                if (seriesMatch) {
                    bookNumber = parseInt(seriesMatch[1]);
                }
                // If not in series field, try title (e.g., "Spellmonger 17")
                if (!bookNumber) {
                    const titleMatch = title.match(/\b(\d+)\b/);
                    if (titleMatch) {
                        const num = parseInt(titleMatch[1]);
                        if (num > 0 && num < 100) {
                            bookNumber = num;
                        }
                    }
                }
                // Extract release date (e.g., "Release date: 03-03-26")
                let releaseDateRaw = null;
                const dateMatch = seriesText.match(/Release date:\s*([^\n]+)/i);
                if (dateMatch) {
                    releaseDateRaw = dateMatch[1].trim();
                }
                // Extract availability from buttons
                let availability = 'unknown';
                const containerText = container.textContent?.toLowerCase() || '';
                if (containerText.includes('pre-order') || containerText.includes('preorder')) {
                    availability = 'preorder';
                }
                else if (containerText.includes('play') ||
                    containerText.includes('add to cart') ||
                    containerText.includes('buy now') ||
                    containerText.includes('in your library')) {
                    availability = 'available';
                }
                items.push({
                    title,
                    url: url.split('?')[0],
                    releaseDate: releaseDateRaw, // Will be normalized by backend
                    releaseDateRaw,
                    availability,
                    source: 'audible',
                    bookNumber
                });
            }
            return { items };
        }
        // Inline Amazon extractor
        function extractAmazonData(max) {
            const items = [];
            const containers = document.querySelectorAll('[data-asin]:not([data-asin=""])');
            for (let i = 0; i < Math.min(containers.length, max); i++) {
                const container = containers[i];
                const titleEl = container.querySelector('h2 a, .s-line-clamp-2');
                const title = titleEl?.textContent?.trim();
                const url = titleEl?.href;
                if (title && url) {
                    items.push({
                        title,
                        url: url.split('?')[0],
                        releaseDate: null,
                        releaseDateRaw: null,
                        availability: 'unknown',
                        source: 'amazon'
                    });
                }
            }
            return { items };
        }
        // Now call the appropriate function
        try {
            if (source === 'audible') {
                return extractAudibleData(maxResults);
            }
            else {
                return extractAmazonData(maxResults);
            }
        }
        catch (e) {
            return {
                items: [],
                error: `Extraction error: ${e.message || String(e)}`
            };
        }
    }
    /**
     * Reset failure counts (e.g., after settings change)
     */
    static resetFailureCounts() {
        this.failureCounts.clear();
    }
}
Scraper.failureCounts = new Map();
