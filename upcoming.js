/**
 * Shared "Upcoming Books" computation - used by both the options page (Upcoming
 * Books tab) and the popup (Upcoming section), so the two never drift out of sync.
 */
import { StorageManager } from './storage.js';
import { DiffEngine } from './diff.js';
import { matchesSeriesName } from './utils.js';
/**
 * Scan every series' latest Audible snapshot for pre-order items (the only place
 * Audible actually publishes a release date) and build a sorted "what's coming up"
 * list. Only English-language items that pass matchesSeriesName() count, so
 * cross-series pollution and foreign-language editions never show up as a false
 * "upcoming" release. Two extra cross-checks help further:
 *  - the pre-order's book number must match the series' already-computed "next"
 *    number, when both are known
 *  - a narrator that doesn't match any narrator seen on the series' available
 *    books is flagged (not excluded - narrators do legitimately change sometimes)
 */
export async function getUpcomingReleases() {
    const allSeries = await StorageManager.getAllSeries();
    const { snapshots = {} } = await chrome.storage.local.get('snapshots');
    const seriesMap = new Map(allSeries.map(s => [s.id, s]));
    const now = new Date();
    const upcoming = [];
    const isRealEnglishMatch = (item, series) => matchesSeriesName(item.title, series.title) &&
        !DiffEngine.isLikelyNonEnglish(item.title) &&
        !DiffEngine.isForeignEditionVariant(item.title);
    Object.entries(snapshots).forEach(([key, snapshot]) => {
        const seriesId = key.slice(0, key.lastIndexOf('_'));
        const series = seriesMap.get(seriesId);
        if (!series || !snapshot.items)
            return;
        // Narrators seen on this series' already-available books, for the soft
        // narrator cross-check below (imperfect - narrators legitimately change
        // between books sometimes, so this is advisory, not a hard filter).
        const knownNarrators = new Set(snapshot.items
            .filter(i => i.availability === 'available' && i.narrator && isRealEnglishMatch(i, series))
            .map(i => i.narrator.trim().toLowerCase()));
        snapshot.items.forEach(item => {
            if (item.availability !== 'preorder')
                return;
            if (!item.releaseDate)
                return;
            if (!isRealEnglishMatch(item, series))
                return;
            // Book-number cross-check: once we know what number to expect next, require
            // the pre-order to actually carry that number - a missing or mismatched
            // number is far more likely to be a translated edition, spinoff, or wrong
            // listing than the genuine next release (real numbered pre-orders reliably
            // include the number in the title, e.g. "Series 16: A LitRPG Adventure").
            // Skipped entirely for a series with no established next number yet (e.g.
            // one that's never had an available book), where we have nothing to compare.
            if (typeof series.nextAudioBook === 'number' && item.bookNumber !== series.nextAudioBook) {
                return;
            }
            const releaseDate = new Date(item.releaseDate);
            if (isNaN(releaseDate.getTime()))
                return;
            const daysUntilRelease = Math.ceil((releaseDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            // A pre-order that's already "released" per its date just hasn't flipped to
            // available in a search result yet - drop it once it's more than a couple
            // days stale rather than showing permanently-overdue noise.
            if (daysUntilRelease < -2)
                return;
            const narratorMismatch = knownNarrators.size > 0 && item.narrator &&
                !knownNarrators.has(item.narrator.trim().toLowerCase());
            upcoming.push({
                seriesId: series.id,
                seriesTitle: series.title,
                bookTitle: item.title,
                bookNumber: item.bookNumber,
                releaseDate: item.releaseDate,
                releaseDateRaw: item.releaseDateRaw || item.releaseDate,
                daysUntilRelease,
                url: item.url,
                narrator: item.narrator,
                narratorMismatch
            });
        });
    });
    upcoming.sort((a, b) => a.daysUntilRelease - b.daysUntilRelease);
    // De-dupe the same book appearing more than once (e.g. re-scraped under a
    // slightly different ASIN before it's confirmed as the same release).
    const seen = new Set();
    return upcoming.filter(release => {
        const key = `${release.seriesId}_${release.bookTitle}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
