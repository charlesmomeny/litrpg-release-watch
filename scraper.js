/**
 * Scraper - fetches and parses Audible/Amazon pages
 * Supports both lightweight fetch mode and fallback tab-based scraping
 */
import { AudibleParser } from './parsers/audible.js';
import { AmazonParser } from './parsers/amazon.js';
import { normalizeDate } from './utils.js';
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
            // Create inactive tab in a hidden, unfocused window so the user never sees it
            const windowId = await this.getHiddenWindowId();
            const tab = await chrome.tabs.create({
                url,
                active: false,
                ...(windowId !== null ? { windowId } : {})
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
                    // Extract narrator (copied from parsers/audible.js extractNarrator)
                    function extractNarrator(container) {
                        const selectors = [
                            '.narratorLabel',
                            '.bc-size-small a[href*="/narrator/"]',
                            '[class*="narrator"]'
                        ];
                        for (const selector of selectors) {
                            const elements = Array.from(container.querySelectorAll(selector));
                            for (const element of elements) {
                                const text = element.textContent?.trim() || '';
                                if (text && text.length > 0 && text.length < 100) {
                                    return text.replace(/^(?:narrated by|by)[:\s]*/i, '').trim();
                                }
                            }
                        }
                        return null;
                    }
                    // Detect bot-detection/CAPTCHA pages (copied from parsers/audible.js)
                    function isBlockedPage() {
                        const indicators = [
                            "sorry, we just need to make sure you're not a robot",
                            'type the characters you see in this image',
                            'enter the characters you see below',
                            'captcha'
                        ];
                        const bodyText = document.body?.textContent?.toLowerCase() || '';
                        return indicators.some(indicator => bodyText.includes(indicator));
                    }
                    // Find product containers using multiple fallback strategies, in case
                    // Audible's markup shifts and the primary selector stops matching
                    // (copied from parsers/audible.js findProductContainers)
                    function findAudibleContainers(max) {
                        const strategies = [
                            () => document.querySelectorAll('li.productListItem'),
                            () => document.querySelectorAll('.productListItem'),
                            () => document.querySelectorAll('li[data-asin]'),
                            () => document.querySelectorAll('.center-column li.bc-list-item'),
                            () => document.querySelectorAll('li[class*="product"]'),
                        ];
                        for (const strategy of strategies) {
                            const found = strategy();
                            // Filter out navigation/category noise - a real search results
                            // page should have somewhere between 1 and ~100 results.
                            if (found.length > 0 && found.length < 100) {
                                return found;
                            }
                        }
                        return [];
                    }
                    if (source === 'audible') {
                        if (isBlockedPage()) {
                            return { items: [], error: 'Bot detection / CAPTCHA encountered' };
                        }
                        const items = [];
                        const containers = findAudibleContainers(maxResults);
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
                            // Extract narrator
                            const narrator = extractNarrator(container);
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
                                author: author || undefined,
                                narrator: narrator || undefined
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
            if (result?.items) {
                // The injected page-context function can't import utils.js, so it only
                // extracts the raw "Release date: 03-03-26" text. Normalize it here, back
                // in the extension's own context, so releaseDate is an actual comparable
                // date instead of an unparsed string (needed for the Upcoming Books view).
                result.items.forEach(item => {
                    if (!item.releaseDate || item.releaseDate === item.releaseDateRaw) {
                        item.releaseDate = normalizeDate(item.releaseDateRaw) || null;
                    }
                });
            }
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
     * Get (or lazily create) a minimized, unfocused window to host scrape tabs in,
     * so the user never sees them pop up or steal focus. Reused across checks;
     * recreated automatically if the user closes it.
     */
    static async getHiddenWindowId() {
        if (this.hiddenWindowId !== null) {
            try {
                await chrome.windows.get(this.hiddenWindowId);
                return this.hiddenWindowId;
            }
            catch (e) {
                // Window no longer exists (e.g. user closed it) - fall through and recreate
                this.hiddenWindowId = null;
            }
        }
        try {
            // Chrome rejects windows.create() calls that combine width/height with
            // state: 'minimized' in one call, so create it normal-sized first, then
            // minimize it in a follow-up update.
            const win = await chrome.windows.create({
                url: 'about:blank',
                type: 'popup',
                focused: false,
                width: 1280,
                height: 900
            });
            await chrome.windows.update(win.id, { state: 'minimized', focused: false });
            this.hiddenWindowId = win.id;
            return this.hiddenWindowId;
        }
        catch (e) {
            // If window creation fails for any reason, fall back to the current window
            // rather than breaking scraping entirely.
            console.warn('Failed to create hidden scraping window, falling back to current window:', e);
            return null;
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
     * Reset failure counts (e.g., after settings change)
     */
    static resetFailureCounts() {
        this.failureCounts.clear();
    }
}
Scraper.failureCounts = new Map();
/** ID of the reused hidden/minimized window used to host scrape tabs (see getHiddenWindowId). */
Scraper.hiddenWindowId = null;
