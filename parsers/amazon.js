/**
 * Amazon parser - extracts book data from Amazon series pages
 */
import { normalizeDate, extractBookNumber, isFinalBook } from '../utils.js';
export class AmazonParser {
    /**
     * Parse Amazon series page HTML
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
            'To discuss automated access to Amazon data please contact',
            'Enter the characters you see below',
            'Type the characters you see in this image',
            'Robot Check'
        ];
        const bodyText = doc.body?.textContent?.toLowerCase() || '';
        return indicators.some(indicator => bodyText.includes(indicator.toLowerCase()));
    }
    /**
     * Extract book items from series page
     */
    static extractItems(doc, maxResults) {
        const items = [];
        // Try multiple selector strategies for series pages
        const containers = this.findProductContainers(doc);
        for (const container of containers.slice(0, maxResults)) {
            try {
                const item = this.extractSingleItem(container);
                if (item) {
                    items.push(item);
                }
            }
            catch (e) {
                console.warn('Failed to extract Amazon item:', e);
            }
        }
        return items;
    }
    /**
     * Find product containers using multiple strategies
     */
    static findProductContainers(doc) {
        const strategies = [
            // Strategy 1: Series item cards
            () => Array.from(doc.querySelectorAll('.a-carousel-card, [data-a-carousel-options]')),
            // Strategy 2: Grid items
            () => Array.from(doc.querySelectorAll('.s-result-item[data-asin]')),
            // Strategy 3: Product cards
            () => Array.from(doc.querySelectorAll('.a-section.a-spacing-base')),
            // Strategy 4: List items in series display
            () => Array.from(doc.querySelectorAll('[data-asin]:not([data-asin=""])')),
        ];
        for (const strategy of strategies) {
            const containers = strategy();
            if (containers.length > 0) {
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
        // Extract book number from title
        const bookNumber = extractBookNumber(title);
        // Detect if this is the final book
        const finalBook = isFinalBook(title, containerText);
        return {
            title,
            url,
            releaseDate: releaseInfo.normalized,
            releaseDateRaw: releaseInfo.raw,
            availability,
            source: 'amazon',
            bookNumber,
            isFinalBook: finalBook,
            rawData: {
                html: container.innerHTML.substring(0, 500)
            }
        };
    }
    /**
     * Extract title
     */
    static extractTitle(container) {
        const selectors = [
            'h2 a span',
            'h2 a',
            '.a-size-medium.a-text-normal',
            '.s-line-clamp-2',
            'a.a-link-normal span.a-text-normal',
            '[data-cy="title-recipe"]'
        ];
        for (const selector of selectors) {
            const element = container.querySelector(selector);
            if (element?.textContent?.trim()) {
                return element.textContent.trim();
            }
        }
        // Fallback: get ASIN and look for any link text
        const asin = container.getAttribute('data-asin');
        if (asin) {
            const links = Array.from(container.querySelectorAll('a'));
            for (const link of links) {
                if (link.href.includes(asin) && link.textContent?.trim()) {
                    return link.textContent.trim();
                }
            }
        }
        return null;
    }
    /**
     * Extract URL
     */
    static extractUrl(container) {
        const selectors = [
            'h2 a',
            'a.a-link-normal',
            'a[href*="/dp/"]',
            'a[href*="/gp/product/"]'
        ];
        for (const selector of selectors) {
            const element = container.querySelector(selector);
            if (element?.href) {
                const url = element.href.startsWith('http')
                    ? element.href
                    : `https://www.amazon.com${element.href}`;
                // Clean URL - remove ref and other tracking params
                try {
                    const urlObj = new URL(url);
                    return `${urlObj.origin}${urlObj.pathname}`;
                }
                catch {
                    return url.split('?')[0];
                }
            }
        }
        // Fallback: construct from ASIN
        const asin = container.getAttribute('data-asin');
        if (asin && asin.length === 10) {
            return `https://www.amazon.com/dp/${asin}`;
        }
        return null;
    }
    /**
     * Extract release date
     */
    static extractReleaseDate(container) {
        const selectors = [
            '.a-color-secondary',
            '.a-size-base.a-color-secondary',
            '[data-cy="publication-date"]',
            '.a-row.a-size-base'
        ];
        for (const selector of selectors) {
            const elements = Array.from(container.querySelectorAll(selector));
            for (const element of elements) {
                const text = element.textContent?.trim() || '';
                // Look for date patterns
                if (text.match(/\d{1,2}[-\/]\d{1,2}[-\/]\d{4}/) ||
                    text.match(/\w+\s+\d{1,2},?\s+\d{4}/) ||
                    text.match(/(?:published|release[d]?)[:\s]/i)) {
                    let dateStr = text;
                    // Clean up common prefixes
                    dateStr = dateStr.replace(/^(?:published|release[d]?)[:\s]*/i, '').trim();
                    // Try to extract just the date part
                    const dateMatch = dateStr.match(/(\w+\s+\d{1,2},?\s+\d{4})|(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/);
                    if (dateMatch) {
                        dateStr = dateMatch[0];
                    }
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
        // Check for pre-order indicators
        if (text.includes('pre-order') ||
            text.includes('preorder') ||
            text.includes('not yet released') ||
            text.includes('coming soon')) {
            return 'preorder';
        }
        // Check for availability indicators
        if (text.includes('in stock') ||
            text.includes('available') ||
            text.includes('add to cart') ||
            text.includes('buy now')) {
            return 'available';
        }
        // Check for unavailability
        if (text.includes('out of stock') ||
            text.includes('currently unavailable')) {
            return 'unknown';
        }
        // Default: if we found a product, assume it's available unless stated otherwise
        return 'available';
    }
}
