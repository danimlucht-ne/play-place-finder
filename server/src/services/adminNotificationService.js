// services/adminNotificationService.js
const { getDb } = require('../database');

/**
 * Creates a notification for the admin dashboard.
 * @param {string} message The notification message.
 * @param {string} type The type of notification (e.g., 'advertising_city_map_ready').
 * @param {string} [regionKey=null] Optional region key to associate with the notification.
 */
async function notify(message, type, regionKey = null) {
    const db = getDb();
    try {
        await db.collection('admin_notifications').insertOne({
            message,
            notificationType: type,
            regionKey,
            isRead: false,
            createdAt: new Date()
        });
        // In a production app, you would also trigger a push notification or email here.
        console.log(`Admin notification created: ${message}`);
    } catch (error) {
        console.error("Failed to create admin notification:", error);
    }
}

module.exports = { notify };
