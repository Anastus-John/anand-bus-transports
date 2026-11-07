// Register Service Worker on Load
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('✅ Service Worker registered with scope:', reg.scope))
        .catch(err => console.error('Service Worker registration error:', err));
}

// Global Variables
let vapidPublicKey = '';

// Helper: Convert VAPID key to Uint8Array
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// 1. Enable Zero-Cost Web Push Alerts
async function enablePushNotifications() {
    if (!('PushManager' in window)) {
        alert('Web Push is not supported on this browser.');
        return;
    }

    try {
        const res = await fetch('/api/vapid-public-key');
        const data = await res.json();
        vapidPublicKey = data.publicKey;

        if (!vapidPublicKey) {
            alert('VAPID Public Key missing on backend server. Check your .env setup.');
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            alert('Notification permission was denied.');
            return;
        }

        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
        });

        await fetch('/api/subscribe-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription)
        });

        document.getElementById('enablePushBtn').innerText = '🔔 Live Push Alerts Active';
        document.getElementById('enablePushBtn').className = 'bg-emerald-600 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow';
        alert('System Push Notifications successfully enabled!');
    } catch (err) {
        console.error('Push Setup Error:', err);
        alert('Failed to enable push alerts: ' + err.message);
    }
}

// 2. Fetch and Render Bookings
async function fetchBookings() {
    try {
        const res = await fetch('/api/bookings');
        const data = await res.json();
        if (data.success) {
            renderBookings(data.bookings);
        }
    } catch (e) {
        console.error('Fetch Bookings Error:', e);
    }
}

function renderBookings(bookings) {
    const feed = document.getElementById('bookingFeed');
    const statTotal = document.getElementById('statTotal');
    const statPending = document.getElementById('statPending');

    statTotal.innerText = bookings.length;
    const pendingCount = bookings.filter(b => b.status === 'PENDING_QUOTE').length;
    statPending.innerText = pendingCount;

    if (bookings.length === 0) {
        feed.innerHTML = `<p class="text-xs text-center text-gray-400 py-10">No bookings logged in system yet.</p>`;
        return;
    }

    feed.innerHTML = bookings.map(b => `
        <div class="p-4 border rounded-lg bg-gray-50 border-gray-200 hover:border-slate-400 transition">
            <div class="flex justify-between items-start">
                <div>
                    <span class="inline-block text-[10px] font-extrabold px-2 py-0.5 rounded bg-slate-900 text-white mb-1">${b.id}</span>
                    <h4 class="font-bold text-slate-900 text-sm">${b.name}</h4>
                    <p class="text-xs text-gray-600 font-semibold">📞 ${b.phone} ${b.email !== 'N/A' ? '| ✉️ ' + b.email : ''}</p>
                </div>
                <span class="text-[10px] font-bold px-2 py-1 rounded ${b.status === 'PENDING_QUOTE' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">
                    ${b.status}
                </span>
            </div>

            <div class="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-700 bg-white p-2 rounded border border-gray-100">
                <div><span class="font-semibold text-gray-400">Route:</span> ${b.pickup} ➔ ${b.destination}</div>
                <div><span class="font-semibold text-gray-400">Date/Time:</span> ${b.dateTime.replace('T', ' ')}</div>
                <div><span class="font-semibold text-gray-400">Passengers:</span> ${b.passengers}</div>
                <div><span class="font-semibold text-gray-400">Budget:</span> ₹${b.budget}</div>
            </div>

            ${b.notes ? `<p class="text-xs text-gray-500 mt-2 italic bg-slate-100 p-2 rounded">"${b.notes}"</p>` : ''}
            
            <div class="mt-3 flex justify-between items-center text-[10px] text-gray-400">
                <span>Created: ${new Date(b.createdAt).toLocaleString()}</span>
                <a href="tel:${b.phone}" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2.5 py-1 rounded text-[11px]">
                    📞 Call Customer
                </a>
            </div>
        </div>
    `).join('');
}

// 3. Connect to Real-time Stream (SSE)
function connectSSE() {
    const eventSource = new EventSource('/api/live-stream');

    eventSource.onmessage = (event) => {
        const newBooking = JSON.parse(event.data);
        console.log('⚡ Real-time SSE Booking Alert:', newBooking);
        fetchBookings(); // Refresh feed on new entry
    };

    eventSource.onerror = (err) => {
        console.warn('SSE Disconnected. Retrying in 5s...');
        eventSource.close();
        setTimeout(connectSSE, 5000);
    };
}

// 4. Form Submit Handler
document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const alertMsg = document.getElementById('alertMsg');
    const submitBtn = document.getElementById('submitBtn');

    submitBtn.disabled = true;
    submitBtn.innerText = 'Processing System Entry...';
    alertMsg.classList.add('hidden');

    const payload = {
        name: document.getElementById('name').value,
        phone: document.getElementById('phone').value,
        email: document.getElementById('email').value,
        pickup: document.getElementById('pickup').value,
        destination: document.getElementById('destination').value,
        dateTime: document.getElementById('dateTime').value,
        passengers: document.getElementById('passengers').value,
        budget: document.getElementById('budget').value,
        notes: document.getElementById('notes').value
    };

    try {
        const res = await fetch('/api/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
            alertMsg.className = 'text-xs p-3 rounded-lg font-medium bg-emerald-100 text-emerald-800 border border-emerald-300';
            alertMsg.innerText = `✅ Success! Booking registered under ID: ${data.booking.id}`;
            alertMsg.classList.remove('hidden');
            document.getElementById('bookingForm').reset();
            fetchBookings();
        } else {
            throw new Error(data.message || 'Submission failed.');
        }
    } catch (err) {
        alertMsg.className = 'text-xs p-3 rounded-lg font-medium bg-red-100 text-red-800 border border-red-300';
        alertMsg.innerText = err.message || 'Error logging booking.';
        alertMsg.classList.remove('hidden');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Submit Booking Request';
    }
});

// Initialize Systems
fetchBookings();
connectSSE();