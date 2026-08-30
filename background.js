/**
 * Background service worker - handles scheduling and series checking
 */
import { StorageManager } from './storage.js';
import { Scraper } from './scraper.js';
import { DiffEngine } from './diff.js';
import { NotificationManager } from './notifications.js';
// CRITICAL: Make modules globally accessible for debugging and checks
globalThis.StorageManager = StorageManager;
globalThis.Scraper = Scraper;
globalThis.DiffEngine = DiffEngine;
globalThis.NotificationManager = NotificationManager;
const ALARM_NAME = 'check-series';
// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
    console.log('LitRPG Release Watch installed');
    // Initialize storage
    await StorageManager.initialize();
    // Set up alarm
    const settings = await StorageManager.getSettings();
    await setupAlarm(settings.pollInterval);
    // Update badge
    const unreadUpdates = await StorageManager.getUnreadUpdates();
    await NotificationManager.updateBadge(unreadUpdates.length);
});
// Handle alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) {
        console.log('Alarm triggered - checking series');
        await checkAllSeries();
    }
});
// Handle notification clicks
chrome.notifications.onClicked.addListener(async (notificationId) => {
    await NotificationManager.handleNotificationClick(notificationId);
});
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    await NotificationManager.handleNotificationClick(notificationId, buttonIndex);
});
// Listen for messages from popup/options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'checkNow') {
        checkAllSeries().then(() => sendResponse({ success: true }));
        return true; // Keep channel open for async response
    }
    if (message.action === 'checkSeries') {
        checkSingleSeries(message.seriesId).then((result) => sendResponse(result));
        return true;
    }
    if (message.action === 'updateSettings') {
        StorageManager.updateSettings(message.settings).then(async (newSettings) => {
            await setupAlarm(newSettings.pollInterval);
            sendResponse({ success: true });
        });
        return true;
    }
    if (message.action === 'getBadgeCount') {
        StorageManager.getUnreadUpdates().then(updates => {
            sendResponse({ count: updates.length });
        });
        return true;
    }
    if (message.action === 'acknowledgeUpdate') {
        // Acknowledge a single update by ID
        StorageManager.acknowledgeUpdate(message.updateId).then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
    if (message.action === 'acknowledgeSeriesUpdates') {
        // Acknowledge all updates for a specific series
        StorageManager.acknowledgeSeriesUpdates(message.seriesId).then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
    if (message.action === 'getUnacknowledgedCount') {
        // Get count of unacknowledged updates (for persistent alerts)
        StorageManager.getUnacknowledgedUpdates().then(updates => {
            sendResponse({ count: updates.length, updates });
        });
        return true;
    }
});
/**
 * Set up check alarm with specified interval
 */
async function setupAlarm(intervalHours) {
    // Clear existing alarm
    await chrome.alarms.clear(ALARM_NAME);
    // Create new alarm
    await chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: intervalHours * 60
    });
    console.log(`Alarm set to check every ${intervalHours} hours`);
}
/**
 * Check all enabled series
 */
async function checkAllSeries() {
    console.log('Starting check of all series...');
    const settings = await StorageManager.getSettings();
    const allSeries = await StorageManager.getAllSeries();
    const enabledSeries = allSeries.filter(s => s.enabled);
    console.log(`Checking ${enabledSeries.length} enabled series`);
    const allUpdates = [];
    for (const series of enabledSeries) {
        try {
            const result = await checkSingleSeries(series.id);
            if (result.updates && result.updates.length > 0) {
                allUpdates.push(...result.updates);
            }
            // Add delay between requests to avoid rate limiting
            await delay(2000);
        }
        catch (e) {
            console.error(`Error checking series ${series.title}:`, e);
        }
    }
    // Update badge
    const unreadUpdates = await StorageManager.getUnreadUpdates();
    await NotificationManager.updateBadge(unreadUpdates.length);
    // Show notifications for new updates
    if (allUpdates.length > 0) {
        await NotificationManager.showNotification(allUpdates, settings);
    }
    console.log(`Check complete. Found ${allUpdates.length} updates.`);
}
/**
 * Check a single series
 */
async function checkSingleSeries(seriesId) {
    const series = await StorageManager.getSeries(seriesId);
    if (!series) {
        return {
            seriesId,
            source: 'audible',
            success: false,
            timestamp: Date.now(),
            itemsFound: 0,
            updates: [],
            error: 'Series not found'
        };
    }
    const settings = await StorageManager.getSettings();
    const allUpdates = [];
    // Check Audible if URL provided
    if (series.audibleSearchUrl) {
        const audibleResult = await checkSource(series, 'audible', series.audibleSearchUrl, settings);
        if (audibleResult.updates.length > 0) {
            allUpdates.push(...audibleResult.updates);
        }
    }
    // Amazon checking is intentionally not wired up here (too much merchandise
    // pollution in Amazon search results vs. audiobook-specific Audible results).
    // checkSource() still supports source: 'amazon' generically if this is revisited.
    // Update last check timestamp (both in separate lastCheck object and in series)
    const timestamp = Date.now();
    await StorageManager.updateLastCheck(seriesId, timestamp);
    // Update series metadata using combined snapshots from both sources
    await updateSeriesMetadataFromBothSources(seriesId, timestamp);
    // Update badge with unread count
    const unreadUpdates = await StorageManager.getUnreadUpdates();
    await NotificationManager.updateBadge(unreadUpdates.length);
    // Show notification if new updates found
    if (allUpdates.length > 0) {
        await NotificationManager.showNotification(allUpdates, settings);
    }
    return {
        seriesId,
        source: 'audible', // Default
        success: true,
        timestamp: Date.now(),
        itemsFound: allUpdates.length,
        updates: allUpdates
    };
}
/**
 * Check a single source for a series
 */
async function checkSource(series, source, url, settings) {
    try {
        // Scrape the page
        const parseResult = source === 'audible'
            ? await Scraper.scrapeAudible(url, settings)
            : await Scraper.scrapeAmazon(url, settings);
        if (parseResult.error) {
            // Log error
            await StorageManager.addErrorLog({
                seriesId: series.id,
                source,
                message: parseResult.error
            });
            // Maybe notify user (rate-limited)
            const shouldNotify = !(await StorageManager.wasRecentlyNotified(series.id, source));
            if (shouldNotify && parseResult.error.includes('Bot detection')) {
                await NotificationManager.showErrorNotification(series.title, parseResult.error, series.id, source);
            }
            return {
                seriesId: series.id,
                source,
                success: false,
                timestamp: Date.now(),
                itemsFound: 0,
                updates: [],
                error: parseResult.error
            };
        }
        // SAFETY CHECK: A scrape that returns 0 items with no explicit error is most likely
        // a transient failure (bot-block that didn't produce recognizable error text, a
        // layout change, or the page not finishing rendering in time) rather than a real
        // "series has no books" result. Treat it as a soft failure and DO NOT save it as
        // the new snapshot - overwriting a real baseline with an empty one would make the
        // next successful check look like a "first check" and silently skip notifying
        // about any books that appear in between (this was likely why some new releases,
        // e.g. Primal Hunter #15, never triggered an alert).
        if (!parseResult.items || parseResult.items.length === 0) {
            console.warn(`${series.title}: Scrape returned 0 items with no error - skipping snapshot update to avoid corrupting baseline`);
            await StorageManager.addErrorLog({
                seriesId: series.id,
                source,
                message: 'Scrape returned 0 items (no explicit error) - possible bot block, layout change, or slow page render. Snapshot was not updated.'
            });
            return {
                seriesId: series.id,
                source,
                success: false,
                timestamp: Date.now(),
                itemsFound: 0,
                updates: [],
                error: 'Zero items scraped - snapshot preserved'
            };
        }
        // SAVE ALL ITEMS (no filtering)
        // User requirement: "capture everything in your logic - all results"
        console.log(`${series.title}: Captured ${parseResult.items.length} items`);
        // Create new snapshot with ALL items
        const newSnapshot = {
            seriesId: series.id,
            source,
            timestamp: Date.now(),
            items: parseResult.items
        };
        // Get old snapshot
        const oldSnapshot = await StorageManager.getSnapshot(series.id, source);
        // Build the set of historically-seen titles for this series from bookHistory.
        // This provides persistent memory across snapshot rotations — a title that
        // Audible dropped out of search results and later brought back with a new
        // ASIN will still be recognized as "already seen".
        const allBookHistory = await StorageManager.getAllBookHistory();
        const historicalTitles = new Set();
        for (const entry of Object.values(allBookHistory)) {
            if (entry.seenInSeriesIds.includes(series.id) && entry.title) {
                historicalTitles.add(entry.title);
            }
        }
        // Compare and detect updates
        const updates = DiffEngine.compareSnapshots(oldSnapshot, newSnapshot, series.title, settings, series.expectedAuthor, historicalTitles);
        // Persist audit log entry capturing what happened during this check
        const audit = DiffEngine.getLastAudit();
        if (audit) {
            await StorageManager.appendAuditEntry(series.id, {
                timestamp: Date.now(),
                source,
                itemsScraped: parseResult.items.length,
                alertsGenerated: updates.length,
                detectionMode: audit.detectionMode,
                trustMode: audit.trustMode,
                trustedAuthors: audit.trustedAuthors,
                rejectionReasons: audit.rejectionReasons,
                candidates: audit.candidates
            });
        }
        // Record every book we saw in this check (for "when did this ASIN first appear?")
        await StorageManager.recordBooksSeen(parseResult.items, series.id);
        // Save new snapshot (also pushes old snapshot to history ring)
        await StorageManager.saveSnapshot(newSnapshot);
        // Auto-detect series completion
        await detectSeriesCompletion(series.id, newSnapshot);
        // Save updates and mark them in book history; update lastNotified on series
        if (updates.length > 0) {
            await StorageManager.addUpdates(updates);
            // For each alert, mark the corresponding book history entry and update series fields
            let highestNotifiedNumber = null;
            let highestNotifiedTitle;
            for (const update of updates) {
                if (update.bookUrl) {
                    const url = update.bookUrl;
                    const asin = url.match(/\/([A-Z0-9]{10})(?:[/?]|$)/)?.[1];
                    if (asin) {
                        await StorageManager.markBookAlerted(asin, series.id);
                    }
                }
                const num = update.bookNumber;
                if (typeof num === 'number' && (highestNotifiedNumber === null || num > highestNotifiedNumber)) {
                    highestNotifiedNumber = num;
                    highestNotifiedTitle = update.bookTitle;
                }
                else if (highestNotifiedTitle === undefined) {
                    highestNotifiedTitle = update.bookTitle;
                }
            }
            await StorageManager.updateLastNotified(series.id, highestNotifiedTitle || updates[0].bookTitle, highestNotifiedNumber);
        }
        return {
            seriesId: series.id,
            source,
            success: true,
            timestamp: Date.now(),
            itemsFound: parseResult.items.length,
            updates
        };
    }
    catch (e) {
        console.error(`Error checking ${source} for ${series.title}:`, e);
        await StorageManager.addErrorLog({
            seriesId: series.id,
            source,
            message: e.message || String(e)
        });
        return {
            seriesId: series.id,
            source,
            success: false,
            timestamp: Date.now(),
            itemsFound: 0,
            updates: [],
            error: e.message || String(e)
        };
    }
}
/**
 * Utility: delay
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Update series metadata after checking (Audible only)
 */
async function updateSeriesMetadataFromBothSources(seriesId, timestamp) {
    const series = await StorageManager.getSeries(seriesId);
    if (!series)
        return;
    // Get snapshot from Audible only
    const audibleSnapshot = await StorageManager.getSnapshot(seriesId, 'audible');
    // Helper: Check if book title matches series name AND is an audiobook (filters search pollution)
    const matchesSeriesName = (itemTitle) => {
        const title = itemTitle.toLowerCase();
        const seriesName = series.title.toLowerCase();
        // FILTER 1: Must match series name (FUZZY match)
        let matchesSeries = false;
        // Normalize for comparison
        const normalizeForMatch = (str) => {
            return str
                .replace(/^the\s+/i, '')
                .replace(/[^\w\s]/g, ' ')
                .replace(/s\b/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        };
        const normalizedSeries = normalizeForMatch(seriesName);
        const normalizedTitle = normalizeForMatch(title);
        if (normalizedTitle.includes(normalizedSeries)) {
            matchesSeries = true;
        }
        // Basic match
        if (title.includes(seriesName)) {
            matchesSeries = true;
        }
        // Try without "The" prefix
        const seriesNameNoThe = seriesName.replace(/^the\s+/, '');
        if (seriesNameNoThe !== seriesName && title.includes(seriesNameNoThe)) {
            matchesSeries = true;
        }
        if (!matchesSeries)
            return false;
        // FILTER 2: AUDIOBOOKS ONLY - Exclude variants/merchandise
        const pollutionKeywords = [
            'graphic novel', 'light novel', 'manga', 'vol.', 'volume 1', 'volume 2', 'volume 3',
            'french edition', 'german edition', 'spanish edition', 'édition française', 'édition',
            'dramatized adaptation', 'dramatized audio', 'full cast', 'full-cast', 'radio play',
            'bookmark', 'shirt', 't-shirt', 'tshirt', 'poster', 'print', 'merch',
            'mug', 'tumbler', 'cup', 'sticker', 'decal', 'sign', 'metal', 'vinyl', 'canvas', 'artwork',
            '[dvd]', '[blu-ray]', 'dvd', 'blu-ray', 'bluray', 'movie', 'film', 'renewed',
            'gift', 'gifts', 'notebook', 'journal', 'calendar'
        ];
        const isPollution = pollutionKeywords.some(keyword => title.includes(keyword));
        return !isPollution;
    };
    // Extract book numbers from AUDIO books (Audible) - AVAILABLE ONLY + MATCHING NAME
    const audioBookNumbers = [];
    if (audibleSnapshot) {
        for (const item of audibleSnapshot.items) {
            // CRITICAL: Only count books that match series name AND are available
            if (matchesSeriesName(item.title) && item.availability === 'available') {
                const num = extractBookNumber(item);
                if (num)
                    audioBookNumbers.push(num);
            }
        }
    }
    // Calculate next audiobook installment
    const nextAudioBook = audioBookNumbers.length > 0
        ? Math.max(...audioBookNumbers) + 1
        : null;
    // Build updates object
    const updates = {
        lastCheck: timestamp,
        lastCheckSuccess: true,
        updatedAt: timestamp,
        nextAudioBook,
        nextInstallment: nextAudioBook?.toString() || series.nextInstallment // For backwards compatibility
    };
    // Log changes
    if (nextAudioBook !== series.nextAudioBook) {
        console.log(`Updated "${series.title}":`);
        console.log(`  🔊 Audio: Next ${nextAudioBook || '?'} (highest: ${Math.max(...audioBookNumbers) || '?'})`);
    }
    // Save all updates
    await StorageManager.saveSeries({
        ...series,
        ...updates
    });
}
/**
 * Extract book number from item (helper function)
 */
function extractBookNumber(item) {
    if (item.bookNumber) {
        const num = typeof item.bookNumber === 'string'
            ? parseInt(item.bookNumber)
            : item.bookNumber;
        if (!isNaN(num) && num > 0 && num < 100) {
            return num;
        }
    }
    // Try to extract from title if not already extracted
    const match = item.title.match(/\b(\d+)\b/);
    if (match) {
        const num = parseInt(match[1]);
        if (num > 0 && num < 100) {
            return num;
        }
    }
    return null;
}
/**
 * Detect if series is complete based on final book markers
 */
async function detectSeriesCompletion(seriesId, snapshot) {
    const series = await StorageManager.getSeries(seriesId);
    if (!series)
        return;
    // Check if any books are marked as final
    const hasFinalBook = snapshot.items.some(item => item.isFinalBook);
    if (hasFinalBook && series.completionStatus !== 'complete') {
        // Update series to mark as complete
        await StorageManager.saveSeries({
            ...series,
            completionStatus: 'complete'
        });
        console.log(`Series "${series.title}" marked as complete (final book detected)`);
    }
}
// Export for testing
export { checkAllSeries, checkSingleSeries };
// CRITICAL FIX: Make functions globally accessible
// Alarms and message handlers need global scope access in service workers
globalThis.checkAllSeries = checkAllSeries;
globalThis.checkSingleSeries = checkSingleSeries;
console.log('✅ Background script loaded - functions globally accessible');
