self.addEventListener('push', (event) => {
    let data = { title: '🚨 NEW BUS BOOKING!', body: 'New customer trip request received!' };
    try {
        data = event.data.json();
    } catch (e) {
        console.log('Push data non-JSON:', event.data.text());
    }

    const options = {
        body: data.body,
        icon: 'https://cdn-icons-png.flaticon.com/512/3448/3448339.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/3448/3448339.png',
        vibrate: [200, 100, 200, 100, 200],
        data: data.data || {},
        actions: [
            { action: 'view', title: 'Open Dashboard' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow('/#admin-section')
    );
});