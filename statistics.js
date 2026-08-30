/**
 * Statistics calculator for dashboard
 */
import { StorageManager } from './storage.js';
export class StatsCalculator {
    /**
     * Calculate all statistics
     */
    static async calculateStatistics() {
        const [allSeries, allUpdates, snapshots, lastCheck] = await Promise.all([
            StorageManager.getAllSeries(),
            StorageManager.getAllUpdates(),
            chrome.storage.local.get('snapshots'),
            chrome.storage.local.get('lastCheck')
        ]);
        const snapshotsData = snapshots.snapshots || {};
        const lastCheckData = lastCheck.lastCheck || {};
        // Basic counts
        const totalSeries = allSeries.length;
        const activeSeries = allSeries.filter(s => s.enabled && s.completionStatus !== 'complete').length;
        const completedSeries = allSeries.filter(s => s.completionStatus === 'complete').length;
        const totalUpdates = allUpdates.length;
        const unreadUpdates = allUpdates.filter(u => !u.read).length;
        // Updates by type
        const updatesByType = {
            NEW_ITEM: 0,
            TITLE_CHANGED: 0,
            DATE_CHANGED: 0,
            AVAILABILITY_CHANGED: 0,
            RUNTIME_CHANGED: 0,
            NARRATOR_CHANGED: 0
        };
        allUpdates.forEach(update => {
            updatesByType[update.type]++;
        });
        // Books by availability from all snapshots
        const booksByAvailability = {
            preorder: 0,
            available: 0,
            unknown: 0
        };
        Object.values(snapshotsData).forEach((snapshot) => {
            if (snapshot.items) {
                snapshot.items.forEach((item) => {
                    const availability = item.availability;
                    if (availability === 'preorder' || availability === 'available' || availability === 'unknown') {
                        booksByAvailability[availability]++;
                    }
                });
            }
        });
        // Upcoming releases
        const upcomingReleases = this.calculateUpcomingReleases(allSeries, snapshotsData);
        // Most active series (most updates)
        const mostActiveSeriesId = this.findMostActiveSeries(allUpdates);
        // Last check time (most recent)
        const lastCheckTime = Object.values(lastCheckData).reduce((max, time) => {
            return Math.max(max, time || 0);
        }, 0);
        return {
            totalSeries,
            activeSeries,
            completedSeries,
            totalUpdates,
            unreadUpdates,
            updatesByType,
            booksByAvailability,
            upcomingReleases,
            mostActiveSeriesId,
            lastCheckTime: lastCheckTime || undefined
        };
    }
    /**
     * Calculate upcoming releases from snapshots
     */
    static calculateUpcomingReleases(allSeries, snapshotsData) {
        const upcoming = [];
        const now = new Date();
        const seriesMap = new Map(allSeries.map(s => [s.id, s]));
        Object.entries(snapshotsData).forEach(([key, snapshot]) => {
            const [seriesId, source] = key.split('_');
            const series = seriesMap.get(seriesId);
            if (!series || !snapshot.items)
                return;
            snapshot.items.forEach((item) => {
                if (item.releaseDate) {
                    const releaseDate = new Date(item.releaseDate);
                    const daysUntilRelease = Math.ceil((releaseDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    // Only include future releases or recent past (within 30 days)
                    if (daysUntilRelease > -30 && daysUntilRelease < 365) {
                        upcoming.push({
                            seriesId: series.id,
                            seriesTitle: series.title,
                            bookTitle: item.title,
                            bookNumber: item.bookNumber,
                            releaseDate: item.releaseDate,
                            releaseDateRaw: item.releaseDateRaw || item.releaseDate,
                            daysUntilRelease,
                            source: item.source,
                            url: item.url
                        });
                    }
                }
            });
        });
        // Sort by release date (soonest first)
        upcoming.sort((a, b) => a.daysUntilRelease - b.daysUntilRelease);
        // Remove duplicates (same book from different sources)
        const seen = new Set();
        return upcoming.filter(release => {
            const key = `${release.seriesId}_${release.bookTitle}`;
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    }
    /**
     * Find series with most updates
     */
    static findMostActiveSeries(allUpdates) {
        const countMap = new Map();
        allUpdates.forEach(update => {
            const count = countMap.get(update.seriesId) || 0;
            countMap.set(update.seriesId, count + 1);
        });
        let maxCount = 0;
        let maxSeriesId;
        countMap.forEach((count, seriesId) => {
            if (count > maxCount) {
                maxCount = count;
                maxSeriesId = seriesId;
            }
        });
        return maxSeriesId;
    }
}
