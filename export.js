/**
 * Snapshot Export Utility
 * Exports snapshots to CSV for backup/debugging
 */
/**
 * Export all snapshots to CSV file
 */
export async function exportSnapshotsToCSV() {
    const data = await chrome.storage.local.get(['snapshots', 'series']);
    const snapshots = data.snapshots || {};
    const series = data.series || {};
    // CSV header
    let csv = 'Series,Source,Timestamp,BookNumber,Title,ASIN,Availability,ReleaseDate,URL\n';
    // Process each snapshot
    for (const [key, snapshot] of Object.entries(snapshots)) {
        const seriesObj = Object.values(series).find((s) => key.startsWith(s.id));
        const seriesName = seriesObj ? seriesObj.title : 'Unknown';
        const source = key.endsWith('_audible') ? 'Audible' : 'Amazon';
        const timestamp = new Date(snapshot.timestamp).toISOString();
        // Add each item
        snapshot.items.forEach((item) => {
            const bookNum = extractBookNumber(item.title) || '';
            const asin = extractAsin(item.url) || '';
            const title = escapeCsv(item.title);
            const availability = item.availability || '';
            const releaseDate = item.releaseDate || '';
            const url = item.url || '';
            csv += `${escapeCsv(seriesName)},${source},${timestamp},${bookNum},${title},${asin},${availability},${releaseDate},${url}\n`;
        });
    }
    // Create download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const filename = `litrpg-snapshots-${new Date().toISOString().split('T')[0]}.csv`;
    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`✅ Exported ${Object.keys(snapshots).length} snapshots to ${filename}`);
}
/**
 * Export summary statistics to CSV
 */
export async function exportSnapshotSummary() {
    const data = await chrome.storage.local.get(['snapshots', 'series']);
    const snapshots = data.snapshots || {};
    const series = data.series || {};
    // CSV header
    let csv = 'Series,Source,ItemCount,MaxBookNumber,LastUpdated,UniqueASINs\n';
    // Process each snapshot
    for (const [key, snapshot] of Object.entries(snapshots)) {
        const seriesObj = Object.values(series).find((s) => key.startsWith(s.id));
        const seriesName = seriesObj ? seriesObj.title : 'Unknown';
        const source = key.endsWith('_audible') ? 'Audible' : 'Amazon';
        const timestamp = new Date(snapshot.timestamp).toLocaleString();
        const items = snapshot.items || [];
        // Calculate stats
        const bookNumbers = items
            .map((i) => extractBookNumber(i.title))
            .filter((n) => n !== null);
        const maxNumber = bookNumbers.length > 0 ? Math.max(...bookNumbers) : 0;
        const asins = new Set(items.map((i) => extractAsin(i.url)).filter((a) => a));
        csv += `${escapeCsv(seriesName)},${source},${items.length},${maxNumber},${timestamp},${asins.size}\n`;
    }
    // Create download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const filename = `litrpg-snapshot-summary-${new Date().toISOString().split('T')[0]}.csv`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`✅ Exported summary for ${Object.keys(snapshots).length} snapshots to ${filename}`);
}
/**
 * Helper: Extract book number from title
 */
function extractBookNumber(title) {
    const patterns = [
        /\bBook\s*#?(\d+)/i,
        /,\s*Book\s+(\d+)/i,
        /:\s*Book\s+(\d+)/i,
        /\b(\d+):\s+[A-Z]/,
        /\s(\d+):\s*A\s+LitRPG/i,
        /\s(\d+)\s*$/,
        /\s(\d+)(?:\s|:)/
    ];
    for (const pattern of patterns) {
        const match = title.match(pattern);
        if (match) {
            const num = parseInt(match[1]);
            if (num > 0 && num < 500) {
                return num;
            }
        }
    }
    return null;
}
/**
 * Helper: Extract ASIN from URL
 */
function extractAsin(url) {
    const match = url.match(/\/([A-Z0-9]{10})(?:[/?]|$)/);
    return match ? match[1] : null;
}
/**
 * Helper: Escape CSV field
 */
function escapeCsv(field) {
    if (!field)
        return '';
    // Escape quotes and wrap in quotes if contains comma, quote, or newline
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
}
