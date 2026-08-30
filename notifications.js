/**
 * Notification manager - handles extension badge and system notifications
 */
import { DiffEngine } from './diff.js';
import { isQuietHours } from './utils.js';
import { StorageManager } from './storage.js';
export class NotificationManager {
    /**
     * Update badge with unread count
     */
    static async updateBadge(unreadCount) {
        try {
            if (unreadCount > 0) {
                await chrome.action.setBadgeText({ text: unreadCount.toString() });
                await chrome.action.setBadgeBackgroundColor({ color: '#D97706' }); // Amber color
            }
            else {
                await chrome.action.setBadgeText({ text: '' });
            }
        }
        catch (e) {
            console.error('Failed to update badge:', e);
        }
    }
    /**
     * Show system notification for updates
     */
    static async showNotification(updates, settings) {
        // Check if notifications are enabled
        if (!settings.systemNotificationsEnabled) {
            return;
        }
        // Check quiet hours
        if (isQuietHours(settings)) {
            return;
        }
        // Group updates by series
        const groupedUpdates = this.groupUpdatesBySeries(updates);
        // Show notification for each series with updates
        for (const [seriesTitle, seriesUpdates] of Object.entries(groupedUpdates)) {
            await this.showSeriesNotification(seriesTitle, seriesUpdates);
        }
    }
    /**
     * Group updates by series
     */
    static groupUpdatesBySeries(updates) {
        const grouped = {};
        for (const update of updates) {
            if (!grouped[update.seriesTitle]) {
                grouped[update.seriesTitle] = [];
            }
            grouped[update.seriesTitle].push(update);
        }
        return grouped;
    }
    /**
     * Show notification for a single series
     */
    static async showSeriesNotification(seriesTitle, updates) {
        try {
            const updateCount = updates.length;
            const firstUpdate = updates[0];
            let message;
            if (updateCount === 1) {
                message = DiffEngine.getTypeLabel(firstUpdate.type);
            }
            else {
                message = `${updateCount} updates detected`;
            }
            const notificationId = `series_${firstUpdate.seriesId}_${Date.now()}`;
            await chrome.notifications.create(notificationId, {
                type: 'basic',
                iconUrl: 'assets/icon128.png',
                title: `Update for ${seriesTitle}`,
                message: message,
                buttons: [
                    { title: 'Open Page' },
                    { title: 'Mark Read' }
                ],
                priority: 1,
                requireInteraction: false
            });
            // Store notification data for button clicks
            await chrome.storage.local.set({
                [`notification_${notificationId}`]: {
                    updateIds: updates.map(u => u.id),
                    url: firstUpdate.bookUrl
                }
            });
            // Auto-clear after 10 seconds
            setTimeout(async () => {
                try {
                    await chrome.notifications.clear(notificationId);
                }
                catch (e) {
                    // Ignore errors
                }
            }, 10000);
        }
        catch (e) {
            console.error('Failed to show notification:', e);
        }
    }
    /**
     * Handle notification button clicks
     */
    static async handleNotificationClick(notificationId, buttonIndex) {
        const key = `notification_${notificationId}`;
        const data = await chrome.storage.local.get(key);
        const notificationData = data[key];
        if (!notificationData)
            return;
        if (buttonIndex === 0) {
            // Open Page button
            await chrome.tabs.create({ url: notificationData.url });
        }
        else if (buttonIndex === 1) {
            // Mark Read button
            for (const updateId of notificationData.updateIds) {
                await StorageManager.markUpdateRead(updateId);
            }
            // Update badge
            const unreadUpdates = await StorageManager.getUnreadUpdates();
            await this.updateBadge(unreadUpdates.length);
        }
        // Clear notification
        await chrome.notifications.clear(notificationId);
        // Clean up storage
        await chrome.storage.local.remove(key);
    }
    /**
     * Show error notification (rate-limited)
     */
    static async showErrorNotification(seriesTitle, errorMessage, seriesId, source) {
        // Check if we recently notified about this error
        const recentlyNotified = await StorageManager.wasRecentlyNotified(seriesId, source);
        if (recentlyNotified) {
            return; // Don't spam error notifications
        }
        try {
            await chrome.notifications.create(`error_${seriesId}_${source}`, {
                type: 'basic',
                iconUrl: 'assets/icon128.png',
                title: `Error checking ${seriesTitle}`,
                message: errorMessage,
                priority: 1,
                requireInteraction: false
            });
            // Mark as notified
            await StorageManager.markErrorNotified(seriesId, source);
        }
        catch (e) {
            console.error('Failed to show error notification:', e);
        }
    }
}
