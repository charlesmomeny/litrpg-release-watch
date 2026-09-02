/**
 * Options page logic
 */
import { StorageManager } from './storage.js';
import { formatTimestamp } from './utils.js';
import { getUpcomingReleases } from './upcoming.js';
// Current editing series ID (null for new)
let editingSeriesId = null;
// DOM Elements
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');
const addSeriesBtn = document.getElementById('addSeriesBtn');
const seriesListContainer = document.getElementById('seriesListContainer');
const seriesListTable = document.getElementById('seriesListTable');
const seriesTableBody = document.getElementById('seriesTableBody');
const noSeriesMessage = document.getElementById('noSeriesMessage');
const noSeriesSearchResults = document.getElementById('noSeriesSearchResults');
const seriesSearchInput = document.getElementById('seriesSearchInput');
const cardViewBtn = document.getElementById('cardViewBtn');
const listViewBtn = document.getElementById('listViewBtn');
// Series list view state - the view mode persists across sessions (last one used
// wins on reload); search/sort are session-only and reset with each page load.
const SERIES_VIEW_MODE_KEY = 'litrpg_seriesViewMode';
let seriesViewMode = localStorage.getItem(SERIES_VIEW_MODE_KEY) === 'list' ? 'list' : 'card';
let seriesSort = { column: 'title', dir: 'asc' };
let seriesSearchQuery = '';
let allSeriesViewModels = [];
const seriesModal = document.getElementById('seriesModal');
const modalTitle = document.getElementById('modalTitle');
const closeModalBtn = document.getElementById('closeModalBtn');
const seriesForm = document.getElementById('seriesForm');
const cancelBtn = document.getElementById('cancelBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const exportDataBtn = document.getElementById('exportDataBtn');
const importDataBtn = document.getElementById('importDataBtn');
const importFileInput = document.getElementById('importFileInput');
// Settings inputs
const pollInterval = document.getElementById('pollInterval');
const maxResults = document.getElementById('maxResults');
const systemNotifications = document.getElementById('systemNotifications');
const quietHoursEnabled = document.getElementById('quietHoursEnabled');
const quietHoursStart = document.getElementById('quietHoursStart');
const quietHoursEnd = document.getElementById('quietHoursEnd');
const quietHoursSettings = document.getElementById('quietHoursSettings');
const dateShiftThreshold = document.getElementById('dateShiftThreshold');
const maxBookAgeDaysInput = document.getElementById('maxBookAgeDays');
const trackPriceChanges = document.getElementById('trackPriceChanges');
const fallbackScrapeEnabled = document.getElementById('fallbackScrapeEnabled');
const ignorePreorders = document.getElementById('ignorePreorders');
// Books preview modal
const booksModal = document.getElementById('booksModal');
const booksModalTitle = document.getElementById('booksModalTitle');
const closeBooksModalBtn = document.getElementById('closeBooksModalBtn');
const booksPreviewList = document.getElementById('booksPreviewList');
const noBooksFound = document.getElementById('noBooksFound');
const previewBooksBtn = document.getElementById('previewBooksBtn');
const testUrlsBtn = document.getElementById('testUrlsBtn');
const validationResults = document.getElementById('validationResults');
const saveSeriesBtn = document.getElementById('saveSeriesBtn');
// Statistics
const refreshUpcomingBtn = document.getElementById('refreshUpcomingBtn');
// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    setupNavigation();
    setupEventListeners();
    setupAuditUI();
    cardViewBtn.classList.toggle('active', seriesViewMode === 'card');
    listViewBtn.classList.toggle('active', seriesViewMode === 'list');
    await loadSeries();
    await loadSettings();
    await loadUpcomingBooks();
    // Deep-link support (e.g. the popup's "View all" upcoming-releases link)
    const requestedTab = location.hash.replace('#', '');
    if (requestedTab) {
        document.querySelector(`.nav-item[data-tab="${requestedTab}"]`)?.click();
    }
});
/**
 * Setup navigation
 */
function setupNavigation() {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabName = item.getAttribute('data-tab');
            // Update active states
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            tabContents.forEach(tab => tab.classList.remove('active'));
            document.getElementById(`${tabName}Tab`)?.classList.add('active');
        });
    });
}
/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Series management
    addSeriesBtn.addEventListener('click', () => openSeriesModal());
    closeModalBtn.addEventListener('click', closeSeriesModal);
    cancelBtn.addEventListener('click', closeSeriesModal);
    seriesForm.addEventListener('submit', handleSeriesSubmit);
    // Click outside modal to close
    seriesModal.addEventListener('click', (e) => {
        if (e.target === seriesModal) {
            closeSeriesModal();
        }
    });
    // Books preview modal
    previewBooksBtn.addEventListener('click', previewBooks);
    closeBooksModalBtn.addEventListener('click', closeBooksModal);
    booksModal.addEventListener('click', (e) => {
        if (e.target === booksModal) {
            closeBooksModal();
        }
    });
    // URL Testing
    testUrlsBtn.addEventListener('click', testSeriesUrls);
    // Series view mode / search / sort
    cardViewBtn.addEventListener('click', () => setSeriesViewMode('card'));
    listViewBtn.addEventListener('click', () => setSeriesViewMode('list'));
    seriesSearchInput.addEventListener('input', () => {
        seriesSearchQuery = seriesSearchInput.value;
        renderSeriesViews();
    });
    seriesListTable.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-sort');
            if (seriesSort.column === column) {
                seriesSort.dir = seriesSort.dir === 'asc' ? 'desc' : 'asc';
            }
            else {
                seriesSort = { column, dir: 'asc' };
            }
            renderSeriesViews();
        });
    });
    // Upcoming Books
    refreshUpcomingBtn.addEventListener('click', loadUpcomingBooks);
    document.querySelectorAll('.nav-item[data-tab="upcoming"]').forEach(item => {
        item.addEventListener('click', () => loadUpcomingBooks());
    });
    // Settings
    quietHoursEnabled.addEventListener('change', () => {
        quietHoursSettings.style.display = quietHoursEnabled.checked ? 'flex' : 'none';
    });
    saveSettingsBtn.addEventListener('click', saveSettings);
    exportDataBtn.addEventListener('click', exportData);
    importDataBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', importData);
}
/**
 * Load series list: fetch everything once, build a plain view-model per series,
 * then hand off to renderSeriesViews() for the actual card/list rendering so
 * switching view modes or re-sorting/searching doesn't need to re-fetch storage.
 */
async function loadSeries() {
    const allSeries = await StorageManager.getAllSeries();
    if (allSeries.length === 0) {
        allSeriesViewModels = [];
        seriesListContainer.style.display = 'none';
        seriesListTable.style.display = 'none';
        noSeriesSearchResults.style.display = 'none';
        noSeriesMessage.style.display = 'flex';
        return;
    }
    noSeriesMessage.style.display = 'none';
    const lastCheck = await chrome.storage.local.get('lastCheck');
    const lastCheckData = lastCheck.lastCheck || {};
    const snapshots = await chrome.storage.local.get('snapshots');
    const snapshotsData = snapshots.snapshots || {};
    const updatesData = await chrome.storage.local.get('updates');
    const allUpdates = updatesData.updates || [];
    allSeriesViewModels = await Promise.all(allSeries.map(series => buildSeriesViewModel(series, lastCheckData[series.id], snapshotsData, allUpdates)));
    renderSeriesViews();
}
/**
 * Compute the display/sort/search data for one series, independent of which view
 * (cards or table) will render it.
 */
async function buildSeriesViewModel(series, lastCheckTime, snapshotsData, allUpdates) {
    const sources = [];
    if (series.audibleSearchUrl)
        sources.push('Audible');
    if (series.amazonSeriesUrl)
        sources.push('Amazon');
    const lastCheckText = lastCheckTime
        ? formatTimestamp(lastCheckTime)
        : 'Not checked';
    // Get book count from snapshots
    let bookCount = 0;
    Object.keys(snapshotsData).forEach(key => {
        if (key.startsWith(`${series.id}_`)) {
            const snapshot = snapshotsData[key];
            if (snapshot.items) {
                bookCount += snapshot.items.length;
            }
        }
    });
    // Get updates for this series
    const seriesUpdates = allUpdates.filter((u) => u.seriesId === series.id);
    const unacknowledgedCount = seriesUpdates.filter((u) => !u.acknowledged).length;
    const hasUnacknowledgedUpdates = unacknowledgedCount > 0;
    const alertBadge = hasUnacknowledgedUpdates
        ? `<span class="alert-badge" title="New updates available!">🔔 ${unacknowledgedCount}</span>`
        : '';
    // Surface the most recent audit check's rejections directly on the card, so a
    // book that was scraped but filtered out (wrong author, title mismatch, too old,
    // etc.) doesn't require digging through the Audit Log tab to notice.
    const seriesAuditLog = await StorageManager.getAuditLog(series.id);
    const latestAudit = seriesAuditLog[0];
    const latestRejectionCount = latestAudit
        ? Object.values(latestAudit.rejectionReasons || {}).reduce((sum, c) => sum + c, 0)
        : 0;
    const auditWarningBadge = latestRejectionCount > 0
        ? `<span class="audit-warning-badge" title="Last check rejected ${latestRejectionCount} candidate(s): ${escapeHtml(Object.entries(latestAudit.rejectionReasons).map(([r, c]) => `${r.replace(/_/g, ' ')} (${c})`).join(', '))}. Click to view in Audit Log.">⚠️ ${latestRejectionCount} rejected</span>`
        : '';
    // Build next book display (audio + text) plus a plain numeric value for sorting
    const nextAudio = series.nextAudioBook;
    const nextText = series.nextTextBook;
    let nextBookDisplay = '';
    let nextSortValue = null;
    if (nextAudio && nextText) {
        nextBookDisplay = `<span title="Audio: ${nextAudio}, Text: ${nextText}">🔊 ${nextAudio} | 📖 ${nextText}</span>`;
        nextSortValue = nextAudio;
    }
    else if (nextAudio) {
        nextBookDisplay = `<span>🔊 Audio: ${nextAudio}</span>`;
        nextSortValue = nextAudio;
    }
    else if (nextText) {
        nextBookDisplay = `<span>📖 Text: ${nextText}</span>`;
        nextSortValue = nextText;
    }
    else {
        // nextAudioBook/nextText are the auto-computed values from the latest scrape;
        // nextInstallment is just a manual placeholder (defaults to "1" when a series
        // is added and never overwritten if auto-detection never succeeds). Label it
        // as unconfirmed so it doesn't read as verified data.
        nextBookDisplay = `<span title="Not yet confirmed by a scrape - manually set or default value">Next: ${escapeHtml(series.nextInstallment)} (unconfirmed)</span>`;
        const parsed = parseInt(series.nextInstallment, 10);
        nextSortValue = isNaN(parsed) ? null : parsed;
    }
    const statusText = series.completionStatus === 'complete' ? 'complete'
        : series.completionStatus === 'ongoing' ? 'ongoing' : 'unknown';
    const statusBadge = statusText === 'complete'
        ? '<span style="color: #059669;">● Complete</span>'
        : statusText === 'ongoing'
            ? '<span style="color: #d97706;">● Ongoing</span>'
            : '<span style="color: #94a3b8;">● Unknown</span>';
    return {
        series,
        id: series.id,
        title: series.title,
        enabled: series.enabled,
        sourcesText: sources.join(', ') || 'No sources',
        bookCount,
        lastCheckText,
        lastCheckTime: lastCheckTime || 0,
        nextBookDisplay,
        nextSortValue,
        statusBadge,
        statusText,
        hasUnacknowledgedUpdates,
        alertBadge,
        auditWarningBadge,
        latestRejectionCount
    };
}
/**
 * Apply the current search/sort/view-mode to allSeriesViewModels and (re)render.
 * Called on load, on search input, on sort-header click, and on view-mode switch.
 */
function renderSeriesViews() {
    const query = seriesSearchQuery.trim().toLowerCase();
    const filtered = query
        ? allSeriesViewModels.filter(vm => vm.title.toLowerCase().includes(query) || vm.sourcesText.toLowerCase().includes(query))
        : allSeriesViewModels.slice();
    filtered.sort((a, b) => compareSeriesViewModels(a, b, seriesSort.column, seriesSort.dir));
    const hasAny = allSeriesViewModels.length > 0;
    const hasResults = filtered.length > 0;
    noSeriesSearchResults.style.display = hasAny && !hasResults ? 'block' : 'none';
    seriesListContainer.style.display = seriesViewMode === 'card' && hasResults ? 'grid' : 'none';
    seriesListTable.style.display = seriesViewMode === 'list' && hasResults ? 'block' : 'none';
    updateSortIndicators();
    if (seriesViewMode === 'card') {
        seriesListContainer.innerHTML = '';
        filtered.forEach(vm => seriesListContainer.appendChild(createSeriesCard(vm)));
    }
    else {
        seriesTableBody.innerHTML = '';
        filtered.forEach(vm => seriesTableBody.appendChild(createSeriesRow(vm)));
    }
}
/**
 * Comparator for the sortable list-view columns. "next" always pushes series with
 * no confirmed next-book number to the bottom, regardless of sort direction, since
 * there's nothing meaningful to compare them by.
 */
function compareSeriesViewModels(a, b, column, dir) {
    const mult = dir === 'asc' ? 1 : -1;
    if (column === 'next') {
        if (a.nextSortValue == null && b.nextSortValue == null)
            return 0;
        if (a.nextSortValue == null)
            return 1;
        if (b.nextSortValue == null)
            return -1;
        return (a.nextSortValue - b.nextSortValue) * mult;
    }
    switch (column) {
        case 'sources':
            return a.sourcesText.localeCompare(b.sourcesText) * mult;
        case 'bookCount':
            return (a.bookCount - b.bookCount) * mult;
        case 'status':
            return a.statusText.localeCompare(b.statusText) * mult;
        case 'lastCheck':
            return (a.lastCheckTime - b.lastCheckTime) * mult;
        case 'title':
        default:
            return a.title.localeCompare(b.title) * mult;
    }
}
function updateSortIndicators() {
    seriesListTable.querySelectorAll('th[data-sort]').forEach(th => {
        const column = th.getAttribute('data-sort');
        th.classList.toggle('sort-active', column === seriesSort.column);
        th.querySelector('.sort-arrow')?.remove();
        const arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        arrow.textContent = column === seriesSort.column ? (seriesSort.dir === 'asc' ? '▲' : '▼') : '↕';
        th.appendChild(arrow);
    });
}
/**
 * Switch between card and list view. Persisted to localStorage (per-browser,
 * scoped to this extension) so the options page reopens in whichever view was
 * last used.
 */
function setSeriesViewMode(mode) {
    seriesViewMode = mode;
    localStorage.setItem(SERIES_VIEW_MODE_KEY, mode);
    cardViewBtn.classList.toggle('active', mode === 'card');
    listViewBtn.classList.toggle('active', mode === 'list');
    renderSeriesViews();
}
/**
 * Create series card element
 */
function createSeriesCard(vm) {
    const card = document.createElement('div');
    card.className = `series-card ${vm.enabled ? '' : 'disabled'} ${vm.hasUnacknowledgedUpdates ? 'series-card-alert' : ''}`;
    card.innerHTML = `
    <div class="series-card-header">
      <h3 class="series-card-title">${escapeHtml(vm.title)} ${vm.alertBadge} ${vm.auditWarningBadge}</h3>
      <div class="series-card-meta">
        <span>${vm.sourcesText}</span>
        ${vm.bookCount > 0 ? `<span>•</span><span>${vm.bookCount} books found</span>` : ''}
        <span>•</span>
        ${vm.nextBookDisplay}
      </div>
    </div>
    <div class="series-card-body">
      <div class="series-info-row">
        <span class="series-info-label">Last Check</span>
        <span class="series-info-value">${vm.lastCheckText}</span>
      </div>
      <div class="series-info-row">
        <span class="series-info-label">Status</span>
        <span class="series-info-value">${vm.statusBadge}</span>
      </div>
    </div>
    <div class="series-card-actions">
      <button class="btn-card edit-btn">Edit</button>
      ${vm.bookCount > 0 ? '<button class="btn-card view-books-btn">View Books</button>' : ''}
      <button class="btn-card check-btn">Check Now</button>
      ${vm.hasUnacknowledgedUpdates ? '<button class="btn-card ack-btn" style="background: #10b981; color: white;">✓ Acknowledge</button>' : ''}
      <button class="btn-card danger delete-btn">Delete</button>
    </div>
  `;
    attachSeriesActionListeners(card, vm);
    return card;
}
/**
 * Create series table row element (list view)
 */
function createSeriesRow(vm) {
    const row = document.createElement('tr');
    row.className = vm.enabled ? '' : 'disabled';
    row.innerHTML = `
    <td class="series-table-title-cell">${escapeHtml(vm.title)} ${vm.alertBadge} ${vm.auditWarningBadge}</td>
    <td>${vm.sourcesText}</td>
    <td>${vm.bookCount || '—'}</td>
    <td>${vm.nextBookDisplay}</td>
    <td>${vm.statusBadge}</td>
    <td>${vm.lastCheckText}</td>
    <td class="series-table-actions-cell">
      <button class="btn-card edit-btn">Edit</button>
      ${vm.bookCount > 0 ? '<button class="btn-card view-books-btn">View Books</button>' : ''}
      <button class="btn-card check-btn">Check Now</button>
      ${vm.hasUnacknowledgedUpdates ? '<button class="btn-card ack-btn" style="background: #10b981; color: white;">✓ Ack</button>' : ''}
      <button class="btn-card danger delete-btn">Delete</button>
    </td>
  `;
    attachSeriesActionListeners(row, vm);
    return row;
}
function attachSeriesActionListeners(el, vm) {
    el.querySelector('.edit-btn')?.addEventListener('click', () => openSeriesModal(vm.series));
    el.querySelector('.view-books-btn')?.addEventListener('click', () => viewSeriesBooks(vm.series));
    el.querySelector('.check-btn')?.addEventListener('click', () => checkSeries(vm.id));
    el.querySelector('.ack-btn')?.addEventListener('click', () => acknowledgeSeriesUpdates(vm.id));
    el.querySelector('.delete-btn')?.addEventListener('click', () => deleteSeries(vm.id));
    el.querySelector('.audit-warning-badge')?.addEventListener('click', () => jumpToAuditLog(vm.id));
}
/**
 * Open series modal for add/edit
 */
function openSeriesModal(series) {
    editingSeriesId = series?.id || null;
    // Reset validation
    validationResults.style.display = 'none';
    validationResults.innerHTML = '';
    saveSeriesBtn.disabled = false;
    if (series) {
        modalTitle.textContent = 'Edit Series';
        document.getElementById('seriesTitle').value = series.title;
        document.getElementById('nextInstallment').value = series.nextInstallment;
        document.getElementById('completionStatus').value = series.completionStatus || 'unknown';
        document.getElementById('audibleUrl').value = series.audibleSearchUrl || '';
        document.getElementById('amazonUrl').value = series.amazonSeriesUrl || '';
        document.getElementById('expectedAuthor').value = Array.isArray(series.expectedAuthor)
            ? series.expectedAuthor.join(', ')
            : (series.expectedAuthor || '');
        document.getElementById('seriesEnabled').checked = series.enabled;
        // Show preview button if editing existing series
        previewBooksBtn.style.display = 'inline-flex';
    }
    else {
        modalTitle.textContent = 'Add Series';
        seriesForm.reset();
        previewBooksBtn.style.display = 'none';
    }
    seriesModal.style.display = 'flex';
}
/**
 * Close series modal
 */
function closeSeriesModal() {
    seriesModal.style.display = 'none';
    seriesForm.reset();
    editingSeriesId = null;
}
/**
 * Handle series form submit
 */
async function handleSeriesSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('seriesTitle').value;
    const nextInstallment = document.getElementById('nextInstallment').value;
    const completionStatus = document.getElementById('completionStatus').value;
    const audibleUrl = document.getElementById('audibleUrl').value.trim();
    const amazonUrl = document.getElementById('amazonUrl').value.trim();
    const expectedAuthorRaw = document.getElementById('expectedAuthor').value.trim();
    const enabled = document.getElementById('seriesEnabled').checked;
    // Check if URLs were provided but not tested
    const hasUrls = audibleUrl || amazonUrl;
    const wasValidated = validationResults.style.display !== 'none';
    if (hasUrls && !wasValidated && !editingSeriesId) {
        const confirmed = confirm('You haven\'t tested the URLs yet. It\'s recommended to test them first to ensure books are found.\n\n' +
            'Click "Cancel" to go back and test URLs, or "OK" to save anyway.');
        if (!confirmed) {
            return;
        }
    }
    // When editing, merge onto the existing stored record instead of replacing it
    // wholesale - StorageManager.saveSeries() does not merge with old data itself,
    // so building seriesData from only the form fields would silently wipe out
    // fields the form doesn't know about (nextAudioBook, lastNotifiedAt, createdAt, etc).
    let seriesData = editingSeriesId
        ? { ...(await StorageManager.getSeries(editingSeriesId)) }
        : {};
    Object.assign(seriesData, {
        title,
        nextInstallment: nextInstallment || '1',
        completionStatus,
        enabled
    });
    if (editingSeriesId) {
        seriesData.id = editingSeriesId;
    }
    if (audibleUrl)
        seriesData.audibleSearchUrl = audibleUrl;
    else
        delete seriesData.audibleSearchUrl;
    if (amazonUrl)
        seriesData.amazonSeriesUrl = amazonUrl;
    else
        delete seriesData.amazonSeriesUrl;
    delete seriesData.notes;
    if (expectedAuthorRaw) {
        const authors = expectedAuthorRaw.split(',').map(a => a.trim()).filter(Boolean);
        seriesData.expectedAuthor = authors.length > 1 ? authors : authors[0];
    }
    else {
        delete seriesData.expectedAuthor;
    }
    await StorageManager.saveSeries(seriesData);
    closeSeriesModal();
    await loadSeries();
}
/**
 * Check a series now
 */
async function checkSeries(seriesId) {
    // Trigger check via background script
    await chrome.runtime.sendMessage({ action: 'checkSeries', seriesId });
    // Reload after a delay
    setTimeout(async () => {
        await loadSeries();
    }, 2000);
}
/**
 * Acknowledge all updates for a series (clears alerts)
 */
async function acknowledgeSeriesUpdates(seriesId) {
    await chrome.runtime.sendMessage({ action: 'acknowledgeSeriesUpdates', seriesId });
    // Reload to show updated UI
    await loadSeries();
}
/**
 * Delete a series
 */
async function deleteSeries(seriesId) {
    if (confirm('Delete this series? This cannot be undone.')) {
        await StorageManager.deleteSeries(seriesId);
        await loadSeries();
    }
}
/**
 * Load settings
 */
async function loadSettings() {
    const settings = await StorageManager.getSettings();
    pollInterval.value = settings.pollInterval.toString();
    maxResults.value = settings.maxResultsPerSource.toString();
    systemNotifications.checked = settings.systemNotificationsEnabled;
    quietHoursEnabled.checked = settings.quietHoursEnabled;
    quietHoursStart.value = settings.quietHoursStart;
    quietHoursEnd.value = settings.quietHoursEnd;
    dateShiftThreshold.value = settings.dateShiftThreshold.toString();
    maxBookAgeDaysInput.value = settings.maxBookAgeDays.toString();
    trackPriceChanges.checked = settings.trackPriceChanges;
    fallbackScrapeEnabled.checked = settings.fallbackScrapeEnabled;
    ignorePreorders.checked = settings.ignorePreorders;
    // Show/hide quiet hours settings
    quietHoursSettings.style.display = settings.quietHoursEnabled ? 'flex' : 'none';
}
/**
 * Save settings
 */
async function saveSettings() {
    const newSettings = {
        pollInterval: parseInt(pollInterval.value),
        maxResultsPerSource: parseInt(maxResults.value),
        systemNotificationsEnabled: systemNotifications.checked,
        quietHoursEnabled: quietHoursEnabled.checked,
        quietHoursStart: quietHoursStart.value,
        quietHoursEnd: quietHoursEnd.value,
        dateShiftThreshold: parseInt(dateShiftThreshold.value),
        maxBookAgeDays: parseInt(maxBookAgeDaysInput.value),
        trackPriceChanges: trackPriceChanges.checked,
        fallbackScrapeEnabled: fallbackScrapeEnabled.checked,
        ignorePreorders: ignorePreorders.checked
    };
    await StorageManager.updateSettings(newSettings);
    // Update alarm via background script
    await chrome.runtime.sendMessage({ action: 'updateSettings', settings: newSettings });
    // Show confirmation
    const originalText = saveSettingsBtn.textContent;
    saveSettingsBtn.textContent = 'Saved!';
    saveSettingsBtn.disabled = true;
    setTimeout(() => {
        saveSettingsBtn.textContent = originalText;
        saveSettingsBtn.disabled = false;
    }, 2000);
}
/**
 * Export data
 */
async function exportData() {
    const data = await StorageManager.exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `litrpg-watch-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}
/**
 * Import data
 */
async function importData() {
    const file = importFileInput.files?.[0];
    if (!file)
        return;
    try {
        const text = await file.text();
        await StorageManager.importData(text);
        // Reload everything
        await loadSeries();
        await loadSettings();
        alert('Data imported successfully!');
    }
    catch (e) {
        alert('Failed to import data. Please check the file format.');
    }
    // Reset input
    importFileInput.value = '';
}
/**
 * Load and display statistics
 */
/**
 * Load and display the Upcoming Books tab
 */
async function loadUpcomingBooks() {
    const releases = await getUpcomingReleases();
    const upcomingList = document.getElementById('upcomingReleasesList');
    const noUpcoming = document.getElementById('noUpcoming');
    if (releases.length === 0) {
        upcomingList.style.display = 'none';
        noUpcoming.style.display = 'block';
        return;
    }
    upcomingList.style.display = 'flex';
    noUpcoming.style.display = 'none';
    upcomingList.innerHTML = '';
    releases.forEach(release => {
        const item = document.createElement('div');
        item.className = 'release-item';
        const badgeClass = release.daysUntilRelease <= 0 ? 'past' :
            release.daysUntilRelease < 14 ? 'soon' : 'future';
        const daysText = release.daysUntilRelease <= 0
            ? 'Releasing any day'
            : release.daysUntilRelease === 1
                ? 'Tomorrow'
                : `In ${release.daysUntilRelease} days`;
        const narratorWarning = release.narratorMismatch
            ? `<span class="audit-warning-badge" style="margin-left:8px; cursor:default;" title="Narrator (${escapeHtml(release.narrator || '')}) differs from previous books in this series. Narrators do change sometimes, but double-check this is really the next book before trusting the date.">⚠️ narrator differs</span>`
            : '';
        item.innerHTML = `
      <div class="release-info">
        <div class="release-title">${escapeHtml(release.bookTitle)} ${narratorWarning}</div>
        <div class="release-meta">${escapeHtml(release.seriesTitle)} ${release.bookNumber ? `• Book ${release.bookNumber}` : ''}</div>
      </div>
      <div class="release-date">
        <div class="days-badge ${badgeClass}">${daysText}</div>
        <div style="font-size: 12px; color: var(--color-gray);">${escapeHtml(release.releaseDateRaw || '')}</div>
      </div>
    `;
        const link = document.createElement('a');
        link.href = release.url;
        link.target = '_blank';
        link.className = 'btn-card';
        link.style.marginLeft = '12px';
        link.textContent = 'View';
        item.appendChild(link);
        upcomingList.appendChild(item);
    });
}
/**
 * View books for a series
 */
async function viewSeriesBooks(series) {
    booksModalTitle.textContent = `Books Found: ${series.title}`;
    // Get snapshots for this series
    const snapshots = await chrome.storage.local.get('snapshots');
    const snapshotsData = snapshots.snapshots || {};
    const allBooks = [];
    Object.entries(snapshotsData).forEach(([key, snapshot]) => {
        if (key.startsWith(`${series.id}_`) && snapshot.items) {
            allBooks.push(...snapshot.items.map((item) => ({
                ...item,
                source: snapshot.source
            })));
        }
    });
    if (allBooks.length === 0) {
        booksPreviewList.style.display = 'none';
        noBooksFound.style.display = 'block';
    }
    else {
        booksPreviewList.style.display = 'flex';
        noBooksFound.style.display = 'none';
        booksPreviewList.innerHTML = '';
        // Sort by book number if available
        allBooks.sort((a, b) => {
            if (a.bookNumber && b.bookNumber) {
                const aNum = typeof a.bookNumber === 'number' ? a.bookNumber : parseInt(a.bookNumber);
                const bNum = typeof b.bookNumber === 'number' ? b.bookNumber : parseInt(b.bookNumber);
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return aNum - bNum;
                }
            }
            return a.title.localeCompare(b.title);
        });
        allBooks.forEach(book => {
            const item = document.createElement('div');
            item.className = 'book-preview-item';
            const bookNumberBadge = book.bookNumber
                ? `<div class="book-number-badge">${book.bookNumber}</div>`
                : '';
            const badges = [];
            if (book.availability === 'preorder') {
                badges.push('<span class="book-badge preorder">Pre-order</span>');
            }
            else if (book.availability === 'available') {
                badges.push('<span class="book-badge available">Available</span>');
            }
            if (book.isFinalBook) {
                badges.push('<span class="book-badge final">Final Book</span>');
            }
            const meta = [];
            if (book.releaseDateRaw)
                meta.push(book.releaseDateRaw);
            if (book.narrator)
                meta.push(`🎙️ ${book.narrator}`);
            if (book.runtimeMinutes) {
                const hours = Math.floor(book.runtimeMinutes / 60);
                const mins = book.runtimeMinutes % 60;
                meta.push(`⏱️ ${hours}h ${mins}m`);
            }
            meta.push(`📍 ${book.source === 'audible' ? 'Audible' : 'Amazon'}`);
            item.innerHTML = `
        ${bookNumberBadge}
        <div class="book-preview-info">
          <div class="book-preview-title">${escapeHtml(book.title)}</div>
          <div class="book-preview-meta">
            ${badges.join(' ')}
            ${meta.length > 0 ? `<span>•</span><span>${meta.join(' • ')}</span>` : ''}
          </div>
        </div>
        <div class="book-preview-actions">
          <a href="${book.url}" target="_blank" class="btn-preview">View</a>
        </div>
      `;
            booksPreviewList.appendChild(item);
        });
    }
    booksModal.style.display = 'flex';
}
/**
 * Preview books from modal (when editing series)
 */
async function previewBooks() {
    if (!editingSeriesId)
        return;
    const series = await StorageManager.getSeries(editingSeriesId);
    if (!series)
        return;
    await viewSeriesBooks(series);
}
/**
 * Close books preview modal
 */
function closeBooksModal() {
    booksModal.style.display = 'none';
}
/**
 * Test series URLs before saving
 */
async function testSeriesUrls() {
    const audibleUrl = document.getElementById('audibleUrl').value.trim();
    const amazonUrl = document.getElementById('amazonUrl').value.trim();
    if (!audibleUrl && !amazonUrl) {
        showValidationError('No URLs provided', 'Please enter at least one URL (Audible or Amazon) to test.');
        return;
    }
    // Show loading state
    testUrlsBtn.disabled = true;
    testUrlsBtn.textContent = 'Testing...';
    validationResults.style.display = 'block';
    validationResults.innerHTML = '<p style="text-align: center; color: var(--color-gray);">Testing URLs...</p>';
    const results = {
        audible: null,
        amazon: null,
        hasSuccess: false
    };
    try {
        // Get settings for scraper
        const settings = await StorageManager.getSettings();
        // Test Audible URL
        if (audibleUrl) {
            results.audible = await testSingleUrl(audibleUrl, 'audible', settings);
            if (results.audible.success)
                results.hasSuccess = true;
        }
        // Test Amazon URL
        if (amazonUrl) {
            results.amazon = await testSingleUrl(amazonUrl, 'amazon', settings);
            if (results.amazon.success)
                results.hasSuccess = true;
        }
        // Display results
        displayValidationResults(results);
    }
    catch (e) {
        showValidationError('Testing failed', e.message || String(e));
    }
    finally {
        testUrlsBtn.disabled = false;
        testUrlsBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
        <path d="M22 4L12 14.01l-3-3"/>
      </svg>
      Test URLs
    `;
    }
}
/**
 * Test a single URL
 */
async function testSingleUrl(url, source, settings) {
    try {
        // Import scraper dynamically
        const { Scraper } = await import('./scraper.js');
        let result;
        if (source === 'audible') {
            result = await Scraper.scrapeAudible(url, settings);
        }
        else {
            result = await Scraper.scrapeAmazon(url, settings);
        }
        return {
            success: result.items && result.items.length > 0,
            itemCount: result.items?.length || 0,
            items: result.items || [],
            error: result.error
        };
    }
    catch (e) {
        return {
            success: false,
            itemCount: 0,
            items: [],
            error: e.message || String(e)
        };
    }
}
/**
 * Display validation results
 */
function displayValidationResults(results) {
    let html = '';
    if (results.hasSuccess) {
        html += `
      <div class="validation-header success">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
          <path d="M22 4L12 14.01l-3-3"/>
        </svg>
        Validation Successful
      </div>
    `;
    }
    else {
        html += `
      <div class="validation-header error">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4m0 4h.01"/>
        </svg>
        Validation Failed
      </div>
    `;
    }
    // Audible results
    if (results.audible) {
        html += `<div class="validation-source">`;
        html += `<div class="validation-source-title">Audible</div>`;
        if (results.audible.success) {
            html += `
        <div class="validation-status success">
          ✓ ${results.audible.itemCount} books found
        </div>
        <div class="validation-books-preview">
      `;
            results.audible.items.slice(0, 5).forEach((book) => {
                const number = book.bookNumber ? `<span class="validation-book-number">#${book.bookNumber}</span>` : '';
                html += `
          <div class="validation-book-item">
            ${number} ${escapeHtml(book.title)}
          </div>
        `;
            });
            if (results.audible.itemCount > 5) {
                html += `<div class="validation-book-item" style="font-style: italic; opacity: 0.7;">...and ${results.audible.itemCount - 5} more</div>`;
            }
            html += `</div>`;
            const suggestedAuthor = computeDominantAuthor(results.audible.items);
            if (suggestedAuthor) {
                html += `
          <div class="validation-author-suggestion" style="margin-top:10px; padding:8px 10px; background:#eff6ff; border-left:3px solid #3b82f6; border-radius:3px; font-size:13px;">
            💡 Suggested author lock: <strong>${escapeHtml(suggestedAuthor)}</strong>
            <button type="button" class="btn-card use-author-suggestion-btn" data-author="${escapeHtml(suggestedAuthor)}" style="margin-left:8px;">Use this</button>
          </div>
        `;
            }
        }
        else {
            html += `
        <div class="validation-status error">
          ✗ No books found
        </div>
        <div class="validation-error-details">
          <div class="validation-error-title">Error Details:</div>
          <div class="validation-error-text">${escapeHtml(results.audible.error || 'Unknown error')}</div>
        </div>
      `;
            html += generateSuggestions('audible', results.audible.error);
        }
        html += `</div>`;
    }
    // Amazon results
    if (results.amazon) {
        html += `<div class="validation-source">`;
        html += `<div class="validation-source-title">Amazon</div>`;
        if (results.amazon.success) {
            html += `
        <div class="validation-status success">
          ✓ ${results.amazon.itemCount} books found
        </div>
        <div class="validation-books-preview">
      `;
            results.amazon.items.slice(0, 5).forEach((book) => {
                const number = book.bookNumber ? `<span class="validation-book-number">#${book.bookNumber}</span>` : '';
                html += `
          <div class="validation-book-item">
            ${number} ${escapeHtml(book.title)}
          </div>
        `;
            });
            if (results.amazon.itemCount > 5) {
                html += `<div class="validation-book-item" style="font-style: italic; opacity: 0.7;">...and ${results.amazon.itemCount - 5} more</div>`;
            }
            html += `</div>`;
        }
        else {
            html += `
        <div class="validation-status error">
          ✗ No books found
        </div>
        <div class="validation-error-details">
          <div class="validation-error-title">Error Details:</div>
          <div class="validation-error-text">${escapeHtml(results.amazon.error || 'Unknown error')}</div>
        </div>
      `;
            html += generateSuggestions('amazon', results.amazon.error);
        }
        html += `</div>`;
    }
    // Overall suggestion if both failed
    if (!results.hasSuccess) {
        html += `
      <div class="validation-suggestion">
        <div class="validation-suggestion-title">⚠️ Cannot Save - No Valid URLs</div>
        <ul class="validation-suggestion-list">
          <li>Fix at least one URL above to continue</li>
          <li>Double-check the URLs are correct</li>
          <li>Make sure you're using search results (Audible) or series pages (Amazon)</li>
          <li>Try enabling "Fallback Scraping" in Settings if bot detection is the issue</li>
        </ul>
      </div>
    `;
        saveSeriesBtn.disabled = true;
    }
    else {
        saveSeriesBtn.disabled = false;
        if (results.audible && !results.audible.success || results.amazon && !results.amazon.success) {
            html += `
        <div class="validation-suggestion">
          <div class="validation-suggestion-title">ℹ️ Partial Success</div>
          <ul class="validation-suggestion-list">
            <li>At least one URL works - you can save this series</li>
            <li>Fix the failing URL(s) for complete coverage</li>
            <li>You can also leave failing URLs empty if you only want one source</li>
          </ul>
        </div>
      `;
        }
    }
    validationResults.innerHTML = html;
    validationResults.style.display = 'block';
    validationResults.querySelector('.use-author-suggestion-btn')?.addEventListener('click', (evt) => {
        document.getElementById('expectedAuthor').value = evt.currentTarget.dataset.author;
    });
}
/**
 * Pick the author that appears on a clear majority (>=50%) of scraped items with
 * an author field, to suggest as the series' expectedAuthor lock. Returns null if
 * there's no author data or no clear majority (e.g. mixed/co-authored results).
 */
function computeDominantAuthor(items) {
    const counts = {};
    let totalWithAuthor = 0;
    items.forEach(item => {
        const author = item.author?.trim();
        if (!author)
            return;
        counts[author] = (counts[author] || 0) + 1;
        totalWithAuthor++;
    });
    const entries = Object.entries(counts);
    if (entries.length === 0)
        return null;
    entries.sort((a, b) => b[1] - a[1]);
    const [topAuthor, topCount] = entries[0];
    return topCount / totalWithAuthor >= 0.5 ? topAuthor : null;
}
/**
 * Generate suggestions based on error
 */
function generateSuggestions(source, error) {
    let html = '<div class="validation-suggestion"><div class="validation-suggestion-title">💡 Suggestions:</div><ul class="validation-suggestion-list">';
    if (error?.includes('Bot detection') || error?.includes('CAPTCHA')) {
        html += `
      <li>Enable "Fallback Scraping" in Settings → Advanced</li>
      <li>Try the URL in your browser first to pass CAPTCHA</li>
      <li>Wait a few minutes and try again</li>
    `;
    }
    else if (error?.includes('HTTP')) {
        html += `
      <li>Check that the URL is correct and accessible</li>
      <li>Make sure you're using the full URL including https://</li>
      <li>Try opening the URL in your browser to verify it works</li>
    `;
    }
    else {
        if (source === 'audible') {
            html += `
        <li>Use a search results URL, not an individual book page</li>
        <li>Example: https://www.audible.com/search?keywords=cradle+will+wight</li>
        <li>Make sure the search returns books from your series</li>
      `;
        }
        else {
            html += `
        <li>Use a series page URL, not an individual book page</li>
        <li>Look for "Books in this series" on Amazon</li>
        <li>Click the series name to get the series page URL</li>
      `;
        }
    }
    html += '</ul></div>';
    return html;
}
/**
 * Show validation error
 */
function showValidationError(title, message) {
    validationResults.innerHTML = `
    <div class="validation-header error">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v4m0 4h.01"/>
      </svg>
      ${escapeHtml(title)}
    </div>
    <div class="validation-error-details">
      <div class="validation-error-text">${escapeHtml(message)}</div>
    </div>
  `;
    validationResults.style.display = 'block';
    saveSeriesBtn.disabled = true;
}
/**
 * Escape HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================
// AUDIT LOG UI
// ============================================================

function setupAuditUI() {
    const refreshBtn = document.getElementById('refreshAuditBtn');
    const seriesFilter = document.getElementById('auditSeriesFilter');
    const viewMode = document.getElementById('auditViewMode');
    
    if (!refreshBtn || !seriesFilter || !viewMode) return;
    
    // Lazy-load when the audit tab is first opened
    document.querySelectorAll('.nav-item[data-tab="audit"]').forEach(item => {
        item.addEventListener('click', () => renderAuditLog());
    });
    
    refreshBtn.addEventListener('click', renderAuditLog);
    seriesFilter.addEventListener('change', renderAuditLog);
    viewMode.addEventListener('change', renderAuditLog);
}

/**
 * Switch to the Audit Log tab, filtered to one series showing its rejections.
 * Used by the "⚠️ N rejected" badge on a series card.
 */
async function jumpToAuditLog(seriesId) {
    navItems.forEach(nav => nav.classList.remove('active'));
    document.querySelector('.nav-item[data-tab="audit"]')?.classList.add('active');
    tabContents.forEach(tab => tab.classList.remove('active'));
    document.getElementById('auditTab')?.classList.add('active');
    // renderAuditLog() populates the series filter dropdown on first run, so call it
    // once to ensure the option we're about to select actually exists.
    await renderAuditLog();
    const seriesFilterEl = document.getElementById('auditSeriesFilter');
    const viewModeEl = document.getElementById('auditViewMode');
    if (seriesFilterEl)
        seriesFilterEl.value = seriesId;
    if (viewModeEl)
        viewModeEl.value = 'rejections';
    await renderAuditLog();
}

async function renderAuditLog() {
    const output = document.getElementById('auditOutput');
    const seriesFilter = document.getElementById('auditSeriesFilter');
    const viewMode = document.getElementById('auditViewMode');
    if (!output) return;
    
    output.innerHTML = '<p style="color:#888;">Loading…</p>';
    
    // Populate series filter dropdown (once)
    if (seriesFilter.options.length <= 1) {
        const allSeries = await StorageManager.getAllSeries();
        allSeries
            .sort((a, b) => a.title.localeCompare(b.title))
            .forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.title;
                seriesFilter.appendChild(opt);
            });
    }
    
    const mode = viewMode.value;
    const selectedSeriesId = seriesFilter.value || null;
    
    try {
        if (mode === 'recent') {
            await renderRecentChecks(output, selectedSeriesId);
        } else if (mode === 'rejections') {
            await renderRejections(output, selectedSeriesId);
        } else if (mode === 'firstseen') {
            await renderFirstSeenBooks(output, selectedSeriesId);
        } else if (mode === 'notified') {
            await renderLastNotified(output);
        }
    } catch (e) {
        output.innerHTML = `<p style="color:#c33;">Error: ${escapeHtml(String(e))}</p>`;
    }
}

async function renderRecentChecks(output, seriesIdFilter) {
    const allLogs = await StorageManager.getAllAuditLogs();
    const allSeries = await StorageManager.getAllSeries();
    const seriesById = {};
    allSeries.forEach(s => seriesById[s.id] = s);
    
    let html = '';
    const seriesIds = seriesIdFilter ? [seriesIdFilter] : Object.keys(allLogs);
    
    if (seriesIds.length === 0) {
        output.innerHTML = '<p style="color:#888;">No audit entries yet. Run a check first.</p>';
        return;
    }
    
    seriesIds.forEach(seriesId => {
        const entries = allLogs[seriesId] || [];
        if (entries.length === 0) return;
        const seriesTitle = seriesById[seriesId]?.title || seriesId;
        
        html += `<details open style="margin-bottom:16px; border:1px solid #ddd; border-radius:6px; padding:12px;">`;
        html += `<summary style="cursor:pointer; font-weight:600;">${escapeHtml(seriesTitle)} <span style="color:#888; font-weight:normal;">(${entries.length} checks)</span></summary>`;
        html += `<div style="margin-top:12px;">`;
        
        entries.slice(0, 5).forEach(e => {
            const when = new Date(e.timestamp).toLocaleString();
            const trustBadge = e.trustMode === 'expected'
                ? '<span style="background:#e8f5e9; color:#2e7d32; padding:2px 6px; border-radius:3px; font-size:11px;">AUTHOR LOCKED</span>'
                : '<span style="background:#fff3e0; color:#e65100; padding:2px 6px; border-radius:3px; font-size:11px;">INFERRED TRUST</span>';
            const alertColor = e.alertsGenerated > 0 ? '#2e7d32' : '#888';
            
            html += `<div style="padding:8px 0; border-top:1px solid #eee;">`;
            html += `<div><strong>${when}</strong> · ${e.source} · ${e.detectionMode} · ${trustBadge}</div>`;
            html += `<div style="color:#666; margin:4px 0;">Scraped: ${e.itemsScraped} items · <span style="color:${alertColor};">${e.alertsGenerated} alerts</span></div>`;
            
            if (e.trustedAuthors && e.trustedAuthors.length > 0) {
                html += `<div style="color:#666; font-size:12px;">Trusted: ${escapeHtml(e.trustedAuthors.join(', '))}</div>`;
            }
            
            const reasons = Object.entries(e.rejectionReasons || {});
            if (reasons.length > 0) {
                html += `<div style="margin-top:6px;">Rejections: `;
                html += reasons.map(([r, c]) => `<span style="background:#f5f5f5; padding:2px 6px; border-radius:3px; margin-right:4px; font-size:12px;">${escapeHtml(r)} (${c})</span>`).join('');
                html += `</div>`;
            }
            
            // Show accepted candidates prominently (these are the books that triggered alerts)
            const accepted = (e.candidates || []).filter(c => c.accepted);
            const rejected = (e.candidates || []).filter(c => !c.accepted);
            
            if (accepted.length > 0) {
                html += `<div style="margin-top:8px; padding:6px 10px; background:#e8f5e9; border-left:3px solid #2e7d32; border-radius:3px;">`;
                html += `<div style="font-size:12px; color:#2e7d32; font-weight:600; margin-bottom:4px;">ACCEPTED (${accepted.length})</div>`;
                accepted.forEach(c => {
                    html += `<div style="font-size:13px;">✓ "${escapeHtml(c.title)}"`;
                    if (c.author) html += ` by ${escapeHtml(c.author)}`;
                    if (typeof c.bookNumber === 'number') html += ` (#${c.bookNumber})`;
                    if (c.releaseDate) html += ` <span style="color:#666;">— released ${escapeHtml(c.releaseDate)}</span>`;
                    html += `</div>`;
                });
                html += `</div>`;
            }
            
            if (rejected.length > 0) {
                html += `<details style="margin-top:6px;"><summary style="cursor:pointer; font-size:12px; color:#888;">Show ${rejected.length} rejected candidate(s)</summary>`;
                html += `<ul style="margin:4px 0; padding-left:20px; font-size:12px;">`;
                rejected.forEach(c => {
                    html += `<li><span style="color:#c33;">✗</span> ${escapeHtml(c.title)}`;
                    if (c.author) html += ` <span style="color:#888;">by ${escapeHtml(c.author)}</span>`;
                    if (c.rejectionReason) html += ` <span style="color:#888;">(${escapeHtml(c.rejectionReason)})</span>`;
                    if (c.releaseDate) html += ` <span style="color:#aaa;">— ${escapeHtml(c.releaseDate)}</span>`;
                    html += `</li>`;
                });
                html += `</ul></details>`;
            }
            
            html += `</div>`;
        });
        
        html += `</div></details>`;
    });
    
    if (!html) {
        output.innerHTML = '<p style="color:#888;">No audit entries for this filter.</p>';
    } else {
        output.innerHTML = html;
    }
}

async function renderRejections(output, seriesIdFilter) {
    const allLogs = await StorageManager.getAllAuditLogs();
    const allSeries = await StorageManager.getAllSeries();
    const seriesById = {};
    allSeries.forEach(s => seriesById[s.id] = s);
    
    // Aggregate rejected candidates across recent checks
    const samples = [];
    const seriesIds = seriesIdFilter ? [seriesIdFilter] : Object.keys(allLogs);
    
    seriesIds.forEach(seriesId => {
        const entries = allLogs[seriesId] || [];
        entries.forEach(e => {
            (e.candidates || []).filter(c => !c.accepted).forEach(c => {
                samples.push({
                    seriesTitle: seriesById[seriesId]?.title || seriesId,
                    when: e.timestamp,
                    title: c.title,
                    author: c.author,
                    reason: c.rejectionReason || 'unknown',
                    releaseDate: c.releaseDate
                });
            });
        });
    });
    
    if (samples.length === 0) {
        output.innerHTML = '<p style="color:#888;">No rejections recorded.</p>';
        return;
    }
    
    samples.sort((a, b) => b.when - a.when);
    
    // Group by reason
    const byReason = {};
    samples.forEach(s => {
        byReason[s.reason] = byReason[s.reason] || [];
        byReason[s.reason].push(s);
    });
    
    let html = `<p style="color:#666;">${samples.length} rejection(s), grouped by reason:</p>`;
    Object.entries(byReason).sort((a, b) => b[1].length - a[1].length).forEach(([reason, list]) => {
        html += `<details open style="margin-bottom:12px; border:1px solid #ddd; border-radius:6px; padding:10px;">`;
        html += `<summary style="cursor:pointer; font-weight:600;">${escapeHtml(reason)} <span style="color:#888; font-weight:normal;">(${list.length})</span></summary>`;
        html += `<ul style="margin:8px 0; padding-left:20px; font-size:13px;">`;
        list.slice(0, 30).forEach(s => {
            html += `<li>"${escapeHtml(s.title)}"`;
            if (s.author) html += ` by ${escapeHtml(s.author)}`;
            html += ` <span style="color:#888;">— ${escapeHtml(s.seriesTitle)}, ${new Date(s.when).toLocaleDateString()}`;
            if (s.releaseDate) html += `, released ${escapeHtml(s.releaseDate)}`;
            html += `</span></li>`;
        });
        html += `</ul></details>`;
    });
    
    output.innerHTML = html;
}

async function renderFirstSeenBooks(output, seriesIdFilter) {
    const history = await StorageManager.getAllBookHistory();
    const allSeries = await StorageManager.getAllSeries();
    const seriesById = {};
    allSeries.forEach(s => seriesById[s.id] = s);
    
    let entries = Object.values(history);
    if (seriesIdFilter) {
        entries = entries.filter(e => e.seenInSeriesIds.includes(seriesIdFilter));
    }
    
    if (entries.length === 0) {
        output.innerHTML = '<p style="color:#888;">No book history yet.</p>';
        return;
    }
    
    // Sort by first-seen descending (most recent first)
    entries.sort((a, b) => b.firstSeen - a.firstSeen);
    
    let html = `<p style="color:#666;">${entries.length} unique book(s) seen, sorted by first-seen date:</p>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:13px;">`;
    html += `<thead><tr style="background:#f5f5f5;">
      <th style="text-align:left; padding:8px;">Title</th>
      <th style="text-align:left; padding:8px;">Author</th>
      <th style="text-align:left; padding:8px;">First seen</th>
      <th style="text-align:left; padding:8px;">Alerted?</th>
      <th style="text-align:left; padding:8px;">In series</th>
    </tr></thead><tbody>`;
    
    entries.slice(0, 100).forEach(e => {
        const seriesNames = e.seenInSeriesIds.map(id => seriesById[id]?.title || id).join(', ');
        const alertBadge = e.alertGenerated
            ? `<span style="color:#2e7d32;">✓ ${new Date(e.alertTimestamp).toLocaleDateString()}</span>`
            : `<span style="color:#888;">—</span>`;
        html += `<tr style="border-top:1px solid #eee;">
          <td style="padding:8px;">${escapeHtml(e.title)}</td>
          <td style="padding:8px;">${escapeHtml(e.author || '—')}</td>
          <td style="padding:8px;">${new Date(e.firstSeen).toLocaleString()}</td>
          <td style="padding:8px;">${alertBadge}</td>
          <td style="padding:8px; color:#666;">${escapeHtml(seriesNames)}</td>
        </tr>`;
    });
    
    html += '</tbody></table>';
    if (entries.length > 100) {
        html += `<p style="color:#888; font-size:12px;">…and ${entries.length - 100} more</p>`;
    }
    
    output.innerHTML = html;
}

async function renderLastNotified(output) {
    const allSeries = await StorageManager.getAllSeries();
    
    const sorted = allSeries.slice().sort((a, b) => {
        const at = a.lastNotifiedAt || 0;
        const bt = b.lastNotifiedAt || 0;
        return bt - at;
    });
    
    let html = `<p style="color:#666;">Most recent notification per series:</p>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:13px;">`;
    html += `<thead><tr style="background:#f5f5f5;">
      <th style="text-align:left; padding:8px;">Series</th>
      <th style="text-align:left; padding:8px;">Last alerted book</th>
      <th style="text-align:left; padding:8px;">Book #</th>
      <th style="text-align:left; padding:8px;">When</th>
    </tr></thead><tbody>`;
    
    sorted.forEach(s => {
        const when = s.lastNotifiedAt ? new Date(s.lastNotifiedAt).toLocaleString() : '—';
        const title = s.lastNotifiedBookTitle || '—';
        const num = s.lastNotifiedBookNumber ?? '—';
        const cellStyle = s.lastNotifiedAt ? '' : 'color:#aaa;';
        html += `<tr style="border-top:1px solid #eee; ${cellStyle}">
          <td style="padding:8px;">${escapeHtml(s.title)}</td>
          <td style="padding:8px;">${escapeHtml(title)}</td>
          <td style="padding:8px;">${num}</td>
          <td style="padding:8px;">${when}</td>
        </tr>`;
    });
    
    html += '</tbody></table>';
    output.innerHTML = html;
}
