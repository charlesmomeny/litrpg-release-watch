/**
 * Popup UI logic
 */
import { StorageManager } from './storage.js';
import { DiffEngine } from './diff.js';
import { formatTimestamp } from './utils.js';
import { getUpcomingReleases } from './upcoming.js';
// DOM Elements
const loadingState = document.getElementById('loadingState');
const updatesSection = document.getElementById('updatesSection');
const updatesList = document.getElementById('updatesList');
const noUpdates = document.getElementById('noUpdates');
const upcomingSection = document.getElementById('upcomingSection');
const upcomingList = document.getElementById('upcomingList');
const noUpcoming = document.getElementById('noUpcoming');
const checkNowBtn = document.getElementById('checkNowBtn');
const settingsBtn = document.getElementById('settingsBtn');
const markAllReadBtn = document.getElementById('markAllReadBtn');
const clearUpdatesBtn = document.getElementById('clearUpdatesBtn');
// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    setupEventListeners();
});
/**
 * Load all data
 */
async function loadData() {
    try {
        await Promise.all([
            loadUpdates(),
            loadUpcoming()
        ]);
    }
    catch (e) {
        console.error('Error loading data:', e);
    }
}
/**
 * Load and display updates
 */
async function loadUpdates() {
    const updates = await StorageManager.getAllUpdates();
    // Sort by timestamp (newest first)
    updates.sort((a, b) => b.timestamp - a.timestamp);
    if (updates.length === 0) {
        updatesList.style.display = 'none';
        noUpdates.style.display = 'flex';
        markAllReadBtn.style.display = 'none';
        return;
    }
    updatesList.style.display = 'block';
    noUpdates.style.display = 'none';
    markAllReadBtn.style.display = 'block';
    // Clear existing
    updatesList.innerHTML = '';
    // Show only unread first, then read (max 20 total)
    const unread = updates.filter(u => !u.read).slice(0, 10);
    const read = updates.filter(u => u.read).slice(0, 10);
    const toShow = [...unread, ...read].slice(0, 20);
    toShow.forEach(update => {
        updatesList.appendChild(createUpdateElement(update));
    });
}
/**
 * Create update element
 */
function createUpdateElement(update) {
    const div = document.createElement('div');
    div.className = `update-item ${update.read ? '' : 'unread'}`;
    div.dataset.updateId = update.id;
    const icon = DiffEngine.getTypeEmoji(update.type);
    const description = DiffEngine.getTypeLabel(update.type);
    let diffHtml = '';
    if (update.oldValue !== undefined && update.newValue !== undefined) {
        diffHtml = `
      <div class="update-diff">
        <span class="diff-old">${escapeHtml(String(update.oldValue))}</span>
        <span class="diff-arrow">→</span>
        <span class="diff-new">${escapeHtml(String(update.newValue))}</span>
      </div>
    `;
    }
    div.innerHTML = `
    <div class="update-header">
      <div class="update-type">
        <span>${icon}</span>
        <span>${update.type.replace(/_/g, ' ')}</span>
      </div>
      <div class="update-time">${formatTimestamp(update.timestamp)}</div>
    </div>
    <div class="update-series">${escapeHtml(update.seriesTitle)}</div>
    <div class="update-description">${escapeHtml(update.bookTitle)}</div>
    ${diffHtml}
    <div class="update-actions">
      <button class="btn-update primary" data-action="open">Open Page</button>
      ${!update.read ? '<button class="btn-update" data-action="mark-read">Mark Read</button>' : ''}
    </div>
  `;
    // Add event listeners
    div.querySelector('[data-action="open"]')?.addEventListener('click', () => {
        chrome.tabs.create({ url: update.bookUrl });
        if (!update.read) {
            markUpdateRead(update.id);
        }
    });
    div.querySelector('[data-action="mark-read"]')?.addEventListener('click', () => {
        markUpdateRead(update.id);
    });
    return div;
}
/**
 * Load and display upcoming pre-order releases
 */
async function loadUpcoming() {
    const releases = await getUpcomingReleases();
    if (releases.length === 0) {
        upcomingList.style.display = 'none';
        noUpcoming.style.display = 'block';
        return;
    }
    upcomingList.style.display = 'block';
    noUpcoming.style.display = 'none';
    upcomingList.innerHTML = '';
    // Keep the popup short - the full list is one click away via "View all"
    releases.slice(0, 5).forEach(release => {
        upcomingList.appendChild(createUpcomingElement(release));
    });
}
/**
 * Create an upcoming-release element
 */
function createUpcomingElement(release) {
    const div = document.createElement('div');
    div.className = 'upcoming-item';
    const badgeClass = release.daysUntilRelease <= 0 ? 'soon' :
        release.daysUntilRelease < 14 ? 'soon' : 'future';
    const daysText = release.daysUntilRelease <= 0
        ? 'Releasing any day'
        : release.daysUntilRelease === 1
            ? 'Tomorrow'
            : `In ${release.daysUntilRelease} days`;
    const narratorWarning = release.narratorMismatch
        ? '<span class="upcoming-warning" title="Narrator differs from previous books in this series - double-check this one">⚠️</span>'
        : '';
    div.innerHTML = `
    <div class="upcoming-info">
      <div class="upcoming-title">${escapeHtml(release.bookTitle)} ${narratorWarning}</div>
      <div class="upcoming-series">${escapeHtml(release.seriesTitle)} ${release.bookNumber ? `• Book ${release.bookNumber}` : ''}</div>
    </div>
    <div class="upcoming-date">
      <div class="upcoming-days-badge ${badgeClass}">${daysText}</div>
      <div class="upcoming-date-text">${escapeHtml(release.releaseDateRaw || '')}</div>
    </div>
  `;
    div.addEventListener('click', () => {
        chrome.tabs.create({ url: release.url });
    });
    return div;
}
/**
 * Mark update as read
 */
async function markUpdateRead(updateId) {
    await StorageManager.markUpdateRead(updateId);
    await loadUpdates();
    // Update badge
    const unreadUpdates = await StorageManager.getUnreadUpdates();
    chrome.runtime.sendMessage({ action: 'getBadgeCount' });
}
/**
 * Setup event listeners
 */
function setupEventListeners() {
    checkNowBtn.addEventListener('click', async () => {
        checkNowBtn.disabled = true;
        // Show loading state
        updatesSection.style.display = 'none';
        upcomingSection.style.display = 'none';
        loadingState.style.display = 'flex';
        // Trigger check
        await chrome.runtime.sendMessage({ action: 'checkNow' });
        // Wait a bit for checks to complete
        setTimeout(async () => {
            await loadData();
            // Hide loading state
            loadingState.style.display = 'none';
            updatesSection.style.display = 'block';
            upcomingSection.style.display = 'block';
            checkNowBtn.disabled = false;
        }, 2000);
    });
    settingsBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'options.html' });
    });
    markAllReadBtn.addEventListener('click', async () => {
        await StorageManager.markAllUpdatesRead();
        await loadUpdates();
        // Update badge
        chrome.runtime.sendMessage({ action: 'getBadgeCount' });
    });
    clearUpdatesBtn.addEventListener('click', async () => {
        if (confirm('Clear all updates? This cannot be undone.')) {
            await StorageManager.clearAllUpdates();
            await loadUpdates();
            // Update badge
            chrome.runtime.sendMessage({ action: 'getBadgeCount' });
        }
    });
}
/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
