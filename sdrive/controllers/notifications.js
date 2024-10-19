const { dbLogins } = require('../routes/db-config');

const getNotification = (req, res) => {
    const notificationId = req.params.id;

    dbLogins.query(
        'SELECT head_notifications, msg_notifications, dispatcher_notifications, noteid_notifications, type_notifications FROM notifications WHERE id_notifications = ?',
        [notificationId],
        (err, result) => {
            if (err) {
                return res.json({ status: 'error', error: 'Błąd pobierania powiadomienia' });
            }
            if (result.length === 0) {
                return res.json({ status: 'error', error: 'Powiadomienie nie istnieje' });
            }
            
            res.json({ status: 'success', notification: result[0] });
        }
    );
};

// Nowa funkcja do aktualizacji statusu powiadomienia na "read"
const markNotificationAsRead = (req, res) => {
    const notificationId = req.params.id;

    dbLogins.query(
        'UPDATE notifications SET status_notifications = "read" WHERE id_notifications = ?',
        [notificationId],
        (err, result) => {
            if (err) {
                return res.json({ status: 'error', error: 'Błąd podczas oznaczania powiadomienia jako przeczytane' });
            }
            return res.json({ status: 'success', success: 'Powiadomienie zostało oznaczone jako przeczytane' });
        }
    );
};

module.exports = { getNotification, markNotificationAsRead };
