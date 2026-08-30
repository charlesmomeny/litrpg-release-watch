/**
 * Storage manager for chrome.storage.local
 */
import { generateId, extractAsin } from './utils.js';
const DEFAULT_SETTINGS = {
    pollInterval: 12,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
    systemNotificationsEnabled: true,
    dateShiftThreshold: 7,
    trackPriceChanges: false,
    trackReviewChanges: false,
    fallbackScrapeEnabled: true,
    maxResultsPerSource: 20,
    locales: ['com'],
    ignorePreorders: true,
    maxBookAgeDays: 180
};
export class StorageManager {
    /**
     * Initialize storage with defaults if empty
     */
    static async initialize() {
        const data = await chrome.storage.local.get(null);
        if (!data.series) {
            await chrome.storage.local.set({ series: {} });
        }
        if (!data.snapshots) {
            await chrome.storage.local.set({ snapshots: {} });
        }
        if (!data.updates) {
            await chrome.storage.local.set({ updates: [] });
        }
        if (!data.settings) {
            await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
        }
        if (!data.lastCheck) {
            await chrome.storage.local.set({ lastCheck: {} });
        }
        if (!data.errorLog) {
            await chrome.storage.local.set({ errorLog: [] });
        }
    }
    /**
     * Get all series
     */
    static async getAllSeries() {
        const { series = {} } = await chrome.storage.local.get('series');
        return Object.values(series);
    }
    /**
     * Get series by ID
     */
    static async getSeries(id) {
        const { series = {} } = await chrome.storage.local.get('series');
        return series[id] || null;
    }
    /**
     * Add or update series
     */
    static async saveSeries(seriesData) {
        const { series = {} } = await chrome.storage.local.get('series');
        const id = seriesData.id || generateId();
        const now = Date.now();
        // Preserve ALL properties from input. Spread the input object first so any
        // future field additions (expectedAuthor, lastNotified*, etc.) are kept
        // automatically without needing to update this function. Defaults are then
        // applied for fields that must exist.
        const newSeries = {
            ...seriesData,
            id,
            title: seriesData.title,
            nextInstallment: seriesData.nextInstallment || '1',
            enabled: seriesData.enabled !== undefined ? seriesData.enabled : true,
            completionStatus: seriesData.completionStatus || 'unknown',
            createdAt: seriesData.createdAt || now,
            updatedAt: now
        };
        series[id] = newSeries;
        await chrome.storage.local.set({ series });
        return newSeries;
    }
    /**
     * Delete series
     */
    static async deleteSeries(id) {
        const { series = {}, snapshots = {} } = await chrome.storage.local.get(['series', 'snapshots']);
        delete series[id];
        // Delete associated snapshots
        const snapshotKeys = Object.keys(snapshots).filter(key => key.startsWith(`${id}_`));
        snapshotKeys.forEach(key => delete snapshots[key]);
        await chrome.storage.local.set({ series, snapshots });
    }
    /**
     * Get snapshot for series and source
     */
    static async getSnapshot(seriesId, source) {
        const { snapshots = {} } = await chrome.storage.local.get('snapshots');
        const key = `${seriesId}_${source}`;
        return snapshots[key] || null;
    }
    /**
     * Save snapshot
     */
    static async saveSnapshot(snapshot) {
        const { snapshots = {} } = await chrome.storage.local.get('snapshots');
        const key = `${snapshot.seriesId}_${snapshot.source}`;
        // Push the previous snapshot (if any) into the history ring buffer
        const previous = snapshots[key];
        if (previous) {
            await this.pushSnapshotHistory(key, previous);
        }
        snapshots[key] = snapshot;
        await chrome.storage.local.set({ snapshots });
    }
    static async pushSnapshotHistory(key, snapshot) {
        const { snapshotHistory = {} } = await chrome.storage.local.get('snapshotHistory');
        const ring = snapshotHistory[key] || [];
        ring.unshift(snapshot);
        snapshotHistory[key] = ring.slice(0, this.SNAPSHOT_HISTORY_MAX);
        await chrome.storage.local.set({ snapshotHistory });
    }
    static async getSnapshotHistory(seriesId, source) {
        const { snapshotHistory = {} } = await chrome.storage.local.get('snapshotHistory');
        return snapshotHistory[`${seriesId}_${source}`] || [];
    }
    static async appendAuditEntry(seriesId, entry) {
        const { auditLog = {} } = await chrome.storage.local.get('auditLog');
        const seriesLog = auditLog[seriesId] || [];
        seriesLog.unshift(entry);
        // Trim entries older than retention window
        const cutoff = Date.now() - this.AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        auditLog[seriesId] = seriesLog.filter(e => e.timestamp > cutoff);
        await chrome.storage.local.set({ auditLog });
    }
    static async getAuditLog(seriesId) {
        const { auditLog = {} } = await chrome.storage.local.get('auditLog');
        return auditLog[seriesId] || [];
    }
    static async getAllAuditLogs() {
        const { auditLog = {} } = await chrome.storage.local.get('auditLog');
        return auditLog;
    }
    /**
     * Book history - track every unique ASIN we've ever seen.
     * Used for "when did this book first appear in search results?" investigations.
     */
    static async recordBooksSeen(items, seriesId) {
        if (!items || items.length === 0)
            return;
        const { bookHistory = {} } = await chrome.storage.local.get('bookHistory');
        const now = Date.now();
        items.forEach(book => {
            const asin = extractAsin(book.url);
            if (!asin)
                return;
            const existing = bookHistory[asin];
            if (existing) {
                existing.lastSeen = now;
                // Update title/author in case they've been refined
                if (book.title)
                    existing.title = book.title;
                if (book.author)
                    existing.author = book.author;
                if (typeof book.bookNumber === 'number')
                    existing.bookNumber = book.bookNumber;
                if (!existing.seenInSeriesIds.includes(seriesId)) {
                    existing.seenInSeriesIds.push(seriesId);
                }
            }
            else {
                bookHistory[asin] = {
                    asin,
                    firstSeen: now,
                    lastSeen: now,
                    title: book.title,
                    author: book.author,
                    bookNumber: typeof book.bookNumber === 'number' ? book.bookNumber : undefined,
                    seenInSeriesIds: [seriesId],
                    alertGenerated: false
                };
            }
        });
        await chrome.storage.local.set({ bookHistory });
    }
    static async markBookAlerted(asin, seriesId) {
        if (!asin)
            return;
        const { bookHistory = {} } = await chrome.storage.local.get('bookHistory');
        const entry = bookHistory[asin];
        if (entry) {
            entry.alertGenerated = true;
            entry.alertTimestamp = Date.now();
            entry.alertSeriesId = seriesId;
            await chrome.storage.local.set({ bookHistory });
        }
    }
    static async getBookHistory(asin) {
        const { bookHistory = {} } = await chrome.storage.local.get('bookHistory');
        return bookHistory[asin] || null;
    }
    static async getAllBookHistory() {
        const { bookHistory = {} } = await chrome.storage.local.get('bookHistory');
        return bookHistory;
    }
    /**
     * Update lastNotified fields on a series after a successful alert
     */
    static async updateLastNotified(seriesId, bookTitle, bookNumber) {
        const series = await this.getSeries(seriesId);
        if (!series)
            return;
        series.lastNotifiedAt = Date.now();
        series.lastNotifiedBookTitle = bookTitle;
        if (typeof bookNumber === 'number')
            series.lastNotifiedBookNumber = bookNumber;
        await this.saveSeries(series);
    }
    /**
     * Get all updates
     */
    static async getAllUpdates() {
        const { updates = [] } = await chrome.storage.local.get('updates');
        return updates;
    }
    /**
     * Get unread updates
     */
    static async getUnreadUpdates() {
        const { updates = [] } = await chrome.storage.local.get('updates');
        return updates.filter((u) => !u.read);
    }
    /**
     * Add updates
     */
    static async addUpdates(newUpdates) {
        const { updates = [] } = await chrome.storage.local.get('updates');
        const merged = [...updates, ...newUpdates];
        // Keep last 500 updates
        const trimmed = merged.slice(-500);
        await chrome.storage.local.set({ updates: trimmed });
        // Update badge with unread count
        const unreadCount = trimmed.filter((u) => !u.read).length;
        if (unreadCount > 0) {
            await chrome.action.setBadgeText({ text: unreadCount.toString() });
            await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
        }
        else {
            await chrome.action.setBadgeText({ text: '' });
        }
    }
    /**
     * Mark update as read
     */
    static async markUpdateRead(updateId) {
        const { updates = [] } = await chrome.storage.local.get('updates');
        const update = updates.find((u) => u.id === updateId);
        if (update) {
            update.read = true;
            await chrome.storage.local.set({ updates });
        }
    }
    /**
     * Mark all updates as read
     */
    static async markAllUpdatesRead() {
        const { updates = [] } = await chrome.storage.local.get('updates');
        updates.forEach((u) => u.read = true);
        await chrome.storage.local.set({ updates });
        // Update badge to show 0
        await chrome.action.setBadgeText({ text: '' });
    }
    /**
     * Clear all updates
     */
    static async clearAllUpdates() {
        await chrome.storage.local.set({ updates: [] });
    }
    /**
     * Get settings
     */
    static async getSettings() {
        const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
        return { ...DEFAULT_SETTINGS, ...settings };
    }
    /**
     * Update settings
     */
    static async updateSettings(newSettings) {
        const currentSettings = await this.getSettings();
        const merged = { ...currentSettings, ...newSettings };
        await chrome.storage.local.set({ settings: merged });
        return merged;
    }
    /**
     * Get last check timestamp for series
     */
    static async getLastCheck(seriesId) {
        const { lastCheck = {} } = await chrome.storage.local.get('lastCheck');
        return lastCheck[seriesId] || null;
    }
    /**
     * Update last check timestamp
     */
    static async updateLastCheck(seriesId, timestamp) {
        const { lastCheck = {} } = await chrome.storage.local.get('lastCheck');
        lastCheck[seriesId] = timestamp;
        await chrome.storage.local.set({ lastCheck });
    }
    /**
     * Add error log entry
     */
    static async addErrorLog(entry) {
        const { errorLog = [] } = await chrome.storage.local.get('errorLog');
        const newEntry = {
            ...entry,
            timestamp: Date.now(),
            notified: false
        };
        errorLog.push(newEntry);
        // Keep last 100 errors
        const trimmed = errorLog.slice(-100);
        await chrome.storage.local.set({ errorLog: trimmed });
    }
    /**
     * Mark error as notified
     */
    static async markErrorNotified(seriesId, source) {
        const { errorLog = [] } = await chrome.storage.local.get('errorLog');
        const recentError = errorLog
            .filter((e) => e.seriesId === seriesId && e.source === source && !e.notified)
            .sort((a, b) => b.timestamp - a.timestamp)[0];
        if (recentError) {
            recentError.notified = true;
            await chrome.storage.local.set({ errorLog });
        }
    }
    /**
     * Check if error was recently notified (within 24h)
     */
    static async wasRecentlyNotified(seriesId, source) {
        const { errorLog = [] } = await chrome.storage.local.get('errorLog');
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        return errorLog.some((e) => e.seriesId === seriesId &&
            e.source === source &&
            e.notified &&
            e.timestamp > oneDayAgo);
    }
    /**
     * Acknowledge a single update
     */
    static async acknowledgeUpdate(updateId) {
        const { updates = [] } = await chrome.storage.local.get('updates');
        const update = updates.find((u) => u.id === updateId);
        if (update) {
            update.acknowledged = true;
            update.read = true; // Also mark as read
            await chrome.storage.local.set({ updates });
            // Update badge count
            const unreadCount = updates.filter((u) => !u.read).length;
            if (unreadCount > 0) {
                await chrome.action.setBadgeText({ text: unreadCount.toString() });
                await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
            }
            else {
                await chrome.action.setBadgeText({ text: '' });
            }
        }
    }
    /**
     * Acknowledge all updates for a series
     */
    static async acknowledgeSeriesUpdates(seriesId) {
        const { updates = [] } = await chrome.storage.local.get('updates');
        updates.forEach((update) => {
            if (update.seriesId === seriesId) {
                update.acknowledged = true;
                update.read = true;
            }
        });
        await chrome.storage.local.set({ updates });
        // Update badge count
        const unreadCount = updates.filter((u) => !u.read).length;
        if (unreadCount > 0) {
            await chrome.action.setBadgeText({ text: unreadCount.toString() });
            await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
        }
        else {
            await chrome.action.setBadgeText({ text: '' });
        }
    }
    /**
     * Get unacknowledged updates (for persistent alerts)
     */
    static async getUnacknowledgedUpdates() {
        const { updates = [] } = await chrome.storage.local.get('updates');
        return updates.filter((u) => !u.acknowledged);
    }
    /**
     * Export all data
     */
    static async exportData() {
        const data = await chrome.storage.local.get(null);
        return JSON.stringify(data, null, 2);
    }
    /**
     * Import data
     */
    static async importData(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            await chrome.storage.local.set(data);
        }
        catch (e) {
            throw new Error('Invalid import data');
        }
    }
}
/**
 * Snapshot history - keep the last N snapshots per (seriesId, source) for diagnostic replay.
 */
StorageManager.SNAPSHOT_HISTORY_MAX = 5;
/**
 * Audit log - one entry per check per series. 14-day retention.
 */
StorageManager.AUDIT_RETENTION_DAYS = 14;
