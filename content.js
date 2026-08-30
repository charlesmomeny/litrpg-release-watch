"use strict";
/**
 * Content script - runs in page context for fallback scraping
 * This is mostly handled by scripting.executeScript in the scraper,
 * but this file provides a persistent content script if needed
 */
// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'extractPageData') {
        const source = message.source;
        const maxResults = message.maxResults || 20;
        try {
            const data = extractData(source, maxResults);
            sendResponse({ success: true, data });
        }
        catch (e) {
            sendResponse({ success: false, error: e.message || String(e) });
        }
        return true;
    }
});
/**
 * Extract data from current page
 */
function extractData(source, maxResults) {
    const items = [];
    if (source === 'audible') {
        // Use specific selector that gets ~20 search results (not 1000+ navigation items)
        const containers = document.querySelectorAll('li.productListItem');
        for (let i = 0; i < Math.min(containers.length, maxResults); i++) {
            const container = containers[i];
            // Title selectors that work on current Audible layout
            const titleEl = container.querySelector('h3 a, .bc-heading a, h3.bc-heading a');
            const title = titleEl?.textContent?.trim();
            const url = titleEl?.href;
            if (title && url) {
                // Extract additional fields
                const releaseDateEl = container.querySelector('.releaseDateLabel, .bc-pub-date');
                const runtimeEl = container.querySelector('.runtimeLabel');
                const narratorEl = container.querySelector('.narratorLabel');
                items.push({
                    title,
                    url: url.split('?')[0],
                    releaseDate: releaseDateEl?.textContent?.trim() || null,
                    releaseDateRaw: releaseDateEl?.textContent?.trim() || null,
                    availability: container.textContent?.toLowerCase().includes('pre-order') ? 'preorder' : 'available',
                    source: 'audible',
                    runtimeMinutes: runtimeEl ? parseRuntime(runtimeEl.textContent || '') : undefined,
                    narrator: narratorEl?.textContent?.replace(/^by:\s*/i, '').trim() || null
                });
            }
        }
    }
    else if (source === 'amazon') {
        const containers = document.querySelectorAll('[data-asin]:not([data-asin=""])');
        for (let i = 0; i < Math.min(containers.length, maxResults); i++) {
            const container = containers[i];
            const titleEl = container.querySelector('h2 a, .s-line-clamp-2, a.a-link-normal span.a-text-normal');
            const title = titleEl?.textContent?.trim();
            const url = titleEl?.href ||
                container.querySelector('a[href*="/dp/"]')?.href;
            if (title && url) {
                const releaseDateEl = container.querySelector('.a-color-secondary');
                items.push({
                    title,
                    url: url.split('?')[0],
                    releaseDate: releaseDateEl?.textContent?.trim() || null,
                    releaseDateRaw: releaseDateEl?.textContent?.trim() || null,
                    availability: container.textContent?.toLowerCase().includes('pre-order') ? 'preorder' : 'available',
                    source: 'amazon'
                });
            }
        }
    }
    return { items };
}
/**
 * Parse runtime from string
 */
function parseRuntime(runtimeStr) {
    const hoursMatch = runtimeStr.match(/(\d+)\s*(?:hr|hour)/i);
    const minsMatch = runtimeStr.match(/(\d+)\s*(?:min|minute)/i);
    const hours = hoursMatch ? parseInt(hoursMatch[1]) : 0;
    const mins = minsMatch ? parseInt(minsMatch[1]) : 0;
    const total = hours * 60 + mins;
    return total > 0 ? total : undefined;
}
// CRITICAL: Expose extractData to window scope for fallback scraping
window.extractData = extractData;
