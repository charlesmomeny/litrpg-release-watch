/**
 * Audible parser - extracts book data from Audible search results
 */
import { normalizeDate, parseRuntime, extractBookNumber, isFinalBook } from '../utils.js';
export class AudibleParser {
    /**
     * Parse Audible search results HTML
     */
    static parse(html, maxResults = 20) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            // Check for bot detection / captcha
            if (this.isBlocked(doc)) {
                return {
                    items: [],
                    error: 'Bot detection / CAPTCHA encountered'
                };
            }
            const items = this.extractItems(doc, maxResults);
            return { items };
        }
        catch (e) {
            return {
                items: [],
                error: `Parse error: ${e.message || String(e)}`
            };
        }
    }
    /**
     * Check if page is blocked
     */
    static isBlocked(doc) {
        const indicators = [
            'Sorry, we just need to make sure you\'re not a robot',
            'Type the characters you see in this image',
            'Enter the characters you see below',
            'captcha'
        ];
        const bodyText = doc.body?.textContent?.toLowerCase() || '';
        return indicators.some(indicator => bodyText.includes(indicator.toLowerCase()));
    }
    /**
     * Extract book items from search results
     */
    static extractItems(doc, maxResults) {
        const items = [];
        // Try multiple selector strategies
        const containers = this.findProductContainers(doc);
        for (const container of containers.slice(0, maxResults)) {
            try {
                const item = this.extractSingleItem(container);
                if (item) {
                    items.push(item);
                }
            }
            catch (e) {
                console.warn('Failed to extract item:', e);
            }
        }
        return items;
    }
    /**
     * Find product containers using multiple strategies
     */
    static findProductContainers(doc) {
        const strategies = [
            // Strategy 1: Specific product list items (most reliable for search results)
            () => Array.from(doc.querySelectorAll('li.productListItem')),
            // Strategy 2: Product card class
            () => Array.from(doc.querySelectorAll('.productListItem')),
            // Strategy 3: List items with data-asin
            () => Array.from(doc.querySelectorAll('li[data-asin]')),
            // Strategy 4: Center column products
            () => Array.from(doc.querySelectorAll('.center-column li.bc-list-item')),
            // Strategy 5: Any li with product-specific classes
            () => Array.from(doc.querySelectorAll('li[class*="product"]')),
        ];
        for (const strategy of strategies) {
            const containers = strategy();
            // Filter out navigation/category items - should be 15-30 results for search page
            if (containers.length > 0 && containers.length < 100) {
                return containers;
            }
        }
        return [];
    }
    /**
     * Extract data from a single product container
     */
    static extractSingleItem(container) {
        const title = this.extractTitle(container);
        const url = this.extractUrl(container);
        if (!title || !url)
            return null;
        // container.textContent walks the whole subtree on every access - read it
        // once and share it between availability detection and the final-book check
        // instead of each re-reading it independently.
        const containerText = container.textContent || '';
        const releaseInfo = this.extractReleaseDate(container);
        const availability = this.extractAvailability(containerText);
        const runtime = this.extractRuntime(container);
        const author = this.extractAuthor(container);
        const narrator = this.extractNarrator(container);
        // Audible renders the series name and book number in a separate "Series: X,
        // Book N" / subtitle line, not in the title itself - many titles are just the
        // book's own name with no series info at all (e.g. "Unchained" for "Welcome
        // to the Multiverse, Book 11"). Capture that line so both the book number and
        // the series-name match (matchesSeriesName in utils.js) have a second place to
        // look besides the bare title.
        const seriesInfo = this.extractSeriesInfoText(container);
        const bookNumber = extractBookNumber(title) ?? (seriesInfo ? extractBookNumber(seriesInfo) : undefined);
        // Detect if this is the final book
        const finalBook = isFinalBook(title, containerText);
        return {
            title,
            url,
            releaseDate: releaseInfo.normalized,
            releaseDateRaw: releaseInfo.raw,
            availability,
            source: 'audible',
            bookNumber,
            seriesInfo: seriesInfo || undefined,
            isFinalBook: finalBook,
            author: author || undefined,
            runtimeMinutes: runtime,
            narrator: narrator || undefined,
            rawData: {
                html: container.innerHTML.substring(0, 500) // Keep snippet for debugging
            }
        };
    }
    /**
     * Extract title
     */
    static extractTitle(container) {
        const selectors = [
            'h3 a',
            '.bc-heading a',
            '.bc-list-item-title a',
            'a[aria-label]',
            '.bc-size-headline3 a'
        ];
        for (const selector of selectors) {
            const element = container.querySelector(selector);
            if (element?.textContent?.trim()) {
                return element.textContent.trim();
            }
        }
        return null;
    }
    /**
     * Extract URL
     */
    static extractUrl(container) {
        const selectors = [
            'h3 a',
            '.bc-heading a',
            '.bc-list-item-title a',
            'a[href*="/pd/"]'
        ];
        for (const selector of selectors) {
            const element = container.querySelector(selector);
            if (element?.href) {
                // Make absolute URL
                const url = element.href.startsWith('http')
                    ? element.href
                    : `https://www.audible.com${element.href}`;
                return url.split('?')[0]; // Remove query params
            }
        }
        return null;
    }
    /**
     * Extract release date
     */
    static extractReleaseDate(container) {
        const selectors = [
            '.releaseDateLabel',
            '.bc-pub-date',
            '[class*="release"]',
            '.bc-size-small:not(.bc-color-secondary)'
        ];
        for (const selector of selectors) {
            const elements = Array.from(container.querySelectorAll(selector));
            for (const element of elements) {
                const text = element.textContent?.trim() || '';
                // Look for date patterns
                if (text.match(/\d{1,2}[-\/]\d{1,2}[-\/]\d{4}/) ||
                    text.match(/\w+\s+\d{1,2},?\s+\d{4}/) ||
                    text.match(/release/i)) {
                    const dateStr = text.replace(/release[d:]?\s*/i, '').trim();
                    return {
                        normalized: normalizeDate(dateStr),
                        raw: dateStr
                    };
                }
            }
        }
        return { normalized: null, raw: null };
    }
    /**
     * Extract availability status from the container's already-computed text
     */
    static extractAvailability(containerText) {
        const text = containerText.toLowerCase();
        if (text.includes('pre-order') || text.includes('preorder') || text.includes('coming soon')) {
            return 'preorder';
        }
        if (text.includes('add to cart') || text.includes('buy now') || text.includes('available')) {
            return 'available';
        }
        return 'unknown';
    }
    /**
     * Extract runtime
     */
    static extractRuntime(container) {
        const selectors = [
            '.runtimeLabel',
            '.bc-size-small.bc-color-secondary',
            '[class*="runtime"]'
        ];
        for (const selector of selectors) {
            const elements = Array.from(container.querySelectorAll(selector));
            for (const element of elements) {
                const text = element.textContent?.trim() || '';
                // Look for runtime patterns: "10 hrs and 23 mins", "5 hours", etc.
                if (text.match(/\d+\s*(?:hr|hour|min|minute)/i)) {
                    return parseRuntime(text);
                }
            }
        }
        return undefined;
    }
    /**
     * Extract author
     */
    static extractAuthor(container) {
        const selectors = [
            'a[href*="/author/"]', // Most reliable - author link
            '.authorLabel a', // Author label with link
            '.authorLabel', // Author label
            'li.bc-list-item.authorLabel',
            '.bc-size-small a[href*="/author/"]',
            '[class*="author"] a',
            '[class*="author"]',
            'span[class*="author"]'
        ];
        for (const selector of selectors) {
            const elements = Array.from(container.querySelectorAll(selector));
            for (const element of elements) {
                let text = element.textContent?.trim() || '';
                // Skip empty or too short
                if (!text || text.length < 2)
                    continue;
                // Clean up common prefixes
                text = text.replace(/^(?:by|written by)[:\s]*/i, '').trim();
                // Valid author: reasonable length, not a common false match
                if (text.length > 2 && text.length < 100 &&
                    !text.toLowerCase().includes('narrator') &&
                    !text.toLowerCase().includes('narrated') &&
                    !text.toLowerCase().includes('series') &&
                    !text.toLowerCase().includes('release')) {
                    // Additional cleanup: remove extra whitespace and newlines
                    text = text.replace(/\s+/g, ' ').trim();
                    return text;
                }
            }
        }
        return null;
    }
    /**
     * Extract the "Series: X, Book N" text Audible renders as its own list item,
     * separate from the title. Search-results pages use class "seriesLabel"
     * ("Series: Welcome to the Multiverse, Book 11"); a series' own catalog page
     * instead uses "subtitle" for the same info without the "Series:" prefix
     * ("The Wandering Inn Series, Book 1: Parts 1 and 2") - check both since which
     * one is present depends on the page type.
     */
    static extractSeriesInfoText(container) {
        for (const selector of ['.seriesLabel', '.subtitle']) {
            const text = container.querySelector(selector)?.textContent?.trim();
            if (text)
                return text;
        }
        return null;
    }
    /**
     * Extract narrator
     */
    static extractNarrator(container) {
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
                    // Clean up "Narrated by:" prefix
                    return text.replace(/^(?:narrated by|by)[:\s]*/i, '').trim();
                }
            }
        }
        return null;
    }
}
