/**
 * Utility functions for LitRPG Release Watch
 */
/**
 * Normalize date string to ISO format
 */
export function normalizeDate(dateStr) {
    if (!dateStr)
        return null;
    try {
        // Try parsing common formats
        const cleaned = dateStr.trim();
        // ISO format already
        if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
            return cleaned.split('T')[0];
        }
        // Month DD, YYYY
        const monthDayYear = /^(\w+)\s+(\d{1,2}),?\s+(\d{4})/.exec(cleaned);
        if (monthDayYear) {
            const date = new Date(`${monthDayYear[1]} ${monthDayYear[2]}, ${monthDayYear[3]}`);
            if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
            }
        }
        // DD Month YYYY
        const dayMonthYear = /^(\d{1,2})\s+(\w+)\s+(\d{4})/.exec(cleaned);
        if (dayMonthYear) {
            const date = new Date(`${dayMonthYear[2]} ${dayMonthYear[1]}, ${dayMonthYear[3]}`);
            if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
            }
        }
        // MM/DD/YYYY or MM-DD-YYYY
        const slashDate = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(cleaned);
        if (slashDate) {
            const date = new Date(`${slashDate[3]}-${slashDate[1].padStart(2, '0')}-${slashDate[2].padStart(2, '0')}`);
            if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
            }
        }
        // MM/DD/YY or MM-DD-YY (2-digit year) - Audible commonly shows release dates
        // this way, e.g. "Release date: 03-03-26". Assume 20xx century.
        const slashDateShortYear = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/.exec(cleaned);
        if (slashDateShortYear) {
            const year = 2000 + parseInt(slashDateShortYear[3], 10);
            const date = new Date(`${year}-${slashDateShortYear[1].padStart(2, '0')}-${slashDateShortYear[2].padStart(2, '0')}`);
            if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
            }
        }
        // Try generic Date parsing as last resort
        const date = new Date(cleaned);
        if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
        }
        return null;
    }
    catch (e) {
        return null;
    }
}
/**
 * Calculate days between two dates
 */
export function daysBetween(date1, date2) {
    try {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        const diff = Math.abs(d2.getTime() - d1.getTime());
        return Math.floor(diff / (1000 * 60 * 60 * 24));
    }
    catch (e) {
        return 0;
    }
}
/**
 * Generate unique ID
 */
export function generateId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
/**
 * Deep clone an object
 */
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
/**
 * Check if we're in quiet hours
 */
export function isQuietHours(settings) {
    if (!settings.quietHoursEnabled)
        return false;
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const [startHour, startMin] = settings.quietHoursStart.split(':').map(Number);
    const [endHour, endMin] = settings.quietHoursEnd.split(':').map(Number);
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;
    if (startTime < endTime) {
        return currentTime >= startTime && currentTime < endTime;
    }
    else {
        // Crosses midnight
        return currentTime >= startTime || currentTime < endTime;
    }
}
/**
 * Exponential backoff calculator
 */
export function getBackoffDelay(attemptCount, baseDelayMs = 60000) {
    const maxDelay = 24 * 60 * 60 * 1000; // 24 hours
    const delay = Math.min(baseDelayMs * Math.pow(2, attemptCount), maxDelay);
    return delay;
}
/**
 * Clean and normalize URL
 */
export function normalizeUrl(url) {
    try {
        const urlObj = new URL(url);
        // Remove tracking parameters
        const paramsToKeep = ['keywords', 'field-keywords', 'node', 's'];
        const newParams = new URLSearchParams();
        paramsToKeep.forEach(param => {
            if (urlObj.searchParams.has(param)) {
                newParams.set(param, urlObj.searchParams.get(param));
            }
        });
        return `${urlObj.origin}${urlObj.pathname}${newParams.toString() ? '?' + newParams.toString() : ''}`;
    }
    catch (e) {
        return url;
    }
}
/**
 * Extract ASIN from Amazon/Audible URL
 */
export function extractAsin(url) {
    if (!url)
        return null;
    const match = url.match(/\/([A-Z0-9]{10})(?:[/?]|$)/);
    return match ? match[1] : null;
}
/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1)
        return 'Just now';
    if (diffMins < 60)
        return `${diffMins}m ago`;
    if (diffHours < 24)
        return `${diffHours}h ago`;
    if (diffDays < 7)
        return `${diffDays}d ago`;
    return date.toLocaleDateString();
}
/**
 * Parse runtime from string (e.g., "10 hrs and 23 mins" -> 623)
 */
export function parseRuntime(runtimeStr) {
    if (!runtimeStr)
        return undefined;
    const hoursMatch = runtimeStr.match(/(\d+)\s*(?:hr|hour)/i);
    const minsMatch = runtimeStr.match(/(\d+)\s*(?:min|minute)/i);
    const hours = hoursMatch ? parseInt(hoursMatch[1]) : 0;
    const mins = minsMatch ? parseInt(minsMatch[1]) : 0;
    const total = hours * 60 + mins;
    return total > 0 ? total : undefined;
}
/**
 * Format runtime for display
 */
export function formatRuntime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0)
        return `${mins}m`;
    if (mins === 0)
        return `${hours}h`;
    return `${hours}h ${mins}m`;
}
/**
 * Sanitize HTML to prevent XSS
 */
export function sanitizeHtml(html) {
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
}
/**
 * Debounce function
 */
export function debounce(func, wait) {
    let timeout = null;
    return function (...args) {
        if (timeout)
            clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}
/**
 * Extract book number from title
 * Examples: "Cradle: Book 12" -> 12, "Dungeon Crawler Carl #5" -> 5
 */
export function extractBookNumber(title) {
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
        // "Title 5: Subtitle" or "Title 5 - Subtitle" — number BEFORE subtitle separator.
        // Conservative: requires preceding whitespace, 1-2 digits, optional whitespace,
        // colon/dash, then whitespace + at least one non-whitespace character.
        /\s(\d{1,2})\s*[:\-]\s+\S/,
        // Roman numerals at end
        /\b([IVX]+)\s*$/,
        // "Title 3" (space + 1-2 digits at end) - very last to avoid false matches
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
            // Return as string (e.g., Roman numerals)
            return value;
        }
    }
    return undefined;
}
/**
 * Convert word numbers to integers
 */
function wordToNumber(word) {
    const words = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
        'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
        'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20
    };
    return words[word.toLowerCase()] || null;
}
/**
 * Detect if book is marked as final/last in series
 */
export function isFinalBook(title, description) {
    const finalIndicators = [
        /\bfinal\s+book\b/i,
        /\blast\s+book\b/i,
        /\bconclusion\b/i,
        /\bend\s+of\s+series\b/i,
        /\bseries\s+finale\b/i,
        /\bfinal\s+installment\b/i,
        /\bepilogue\b/i,
        /\bthe\s+end\b/i,
    ];
    const textToCheck = `${title} ${description || ''}`.toLowerCase();
    return finalIndicators.some(pattern => pattern.test(textToCheck));
}
/**
 * Check whether a scraped item's title actually belongs to a tracked series -
 * fuzzy series-name match plus exclusion of merchandise/variant search pollution
 * (graphic novels, foreign editions, physical goods, etc). Used to filter raw
 * snapshot items down to "real" books for a series before aggregating things like
 * next-book-number or upcoming release dates.
 */
export function matchesSeriesName(itemTitle, seriesTitle) {
    const title = (itemTitle || '').toLowerCase();
    const seriesName = (seriesTitle || '').toLowerCase();
    if (!title || !seriesName)
        return false;
    let matchesSeries = false;
    const normalizeForMatch = (str) => str
        .replace(/^the\s+/i, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/s\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const normalizedSeries = normalizeForMatch(seriesName);
    const normalizedTitle = normalizeForMatch(title);
    if (normalizedTitle.includes(normalizedSeries)) {
        matchesSeries = true;
    }
    if (title.includes(seriesName)) {
        matchesSeries = true;
    }
    const seriesNameNoThe = seriesName.replace(/^the\s+/, '');
    if (seriesNameNoThe !== seriesName && title.includes(seriesNameNoThe)) {
        matchesSeries = true;
    }
    if (!matchesSeries)
        return false;
    const pollutionKeywords = [
        'graphic novel', 'light novel', 'manga', 'vol.', 'volume 1', 'volume 2', 'volume 3',
        'french edition', 'german edition', 'spanish edition', 'édition française', 'édition',
        'dramatized adaptation', 'dramatized audio', 'full cast', 'full-cast', 'radio play',
        'bookmark', 'shirt', 't-shirt', 'tshirt', 'poster', 'print', 'merch',
        'mug', 'tumbler', 'cup', 'sticker', 'decal', 'sign', 'metal', 'vinyl', 'canvas', 'artwork',
        '[dvd]', '[blu-ray]', 'dvd', 'blu-ray', 'bluray', 'movie', 'film', 'renewed',
        'gift', 'gifts', 'notebook', 'journal', 'calendar'
    ];
    return !pollutionKeywords.some(keyword => title.includes(keyword));
}
