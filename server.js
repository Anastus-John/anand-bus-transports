require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const nodemailer = require('nodemailer');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ------------------------------------------------------------------
// 1. NATIVE STATIC ENGINE (Automatically serves /admin -> /admin/index.html)
// ------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------------
// 2. CONFIGURATION: EMAIL (NODEMAILER) & WEB PUSH
// ------------------------------------------------------------------
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
});

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        `mailto:${process.env.ADMIN_EMAIL || process.env.GMAIL_USER || 'admin@anandbus.com'}`,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// ------------------------------------------------------------------
// 3. DATA PERSISTENCE
// ------------------------------------------------------------------
const DATA_FILE = path.join(__dirname, 'bookings.json');
let bookings = [];
let pushSubscriptions = [];
let sseClients = [];

if (fs.existsSync(DATA_FILE)) {
    try {
        bookings = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        bookings = [];
    }
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2));
}

async function sendEmailNotifications(booking) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) return;

    const ownerMail = {
        from: `"Anand Transports" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_USER,
        subject: `🚨 NEW BOOKING REQUEST #${booking.id} (${booking.pickup} ➔ ${booking.destination})`,
        html: `
            <h2>🚨 New Bus Booking Received</h2>
            <p><strong>Booking ID:</strong> ${booking.id}</p>
            <p><strong>Customer:</strong> ${booking.name} (${booking.phone})</p>
            <p><strong>Route:</strong> ${booking.pickup} ➔ ${booking.destination}</p>
            <p><strong>Date & Time:</strong> ${booking.dateTime}</p>
            <p><strong>Passengers:</strong> ${booking.passengers}</p>
            <p><a href="${booking.whatsappLink}">💬 Chat on WhatsApp</a></p>
        `
    };

    try {
        await transporter.sendMail(ownerMail);
    } catch (err) {
        console.error('❌ Email Error:', err.message);
    }
}

// ------------------------------------------------------------------
// 4. API ENDPOINTS
// ------------------------------------------------------------------
app.post('/api/bookings', (req, res) => {
    try {
        const { name, phone, email, pickup, destination, dateTime, passengers, budget, notes } = req.body;
        if (!name || !phone || !pickup || !destination || !dateTime) {
            return res.status(400).json({ success: false, message: 'Missing fields' });
        }

        const cleanPhone = phone.replace(/[^0-9]/g, '');
        const whatsappText = encodeURIComponent(`Hello ${name}, thank you for inquiring with Anand Bus Transports for your trip from ${pickup} to ${destination} on ${dateTime}.`);

        const newBooking = {
            id: 'AB-' + Date.now().toString().slice(-6),
            name,
            phone: cleanPhone,
            email: email || 'N/A',
            pickup,
            destination,
            dateTime,
            passengers: parseInt(passengers),
            budget: budget || 'Negotiable',
            notes: notes || '',
            whatsappLink: `https://wa.me/91${cleanPhone}?text=${whatsappText}`,
            status: 'PENDING_QUOTE',
            createdAt: new Date().toISOString()
        };

        bookings.unshift(newBooking);
        saveData();

        sseClients.forEach(c => c.res.write(`data: ${JSON.stringify(newBooking)}\n\n`));
        pushSubscriptions.forEach(sub => {
            webpush.sendNotification(sub, JSON.stringify({
                title: '🚨 NEW BUS BOOKING RECEIVED!',
                body: `${name} | ${pickup} ➔ ${destination}`,
                data: { bookingId: newBooking.id }
            })).catch(() => {});
        });

        sendEmailNotifications(newBooking);
        return res.status(201).json({ success: true, booking: newBooking });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/bookings', (req, res) => res.json({ success: true, count: bookings.length, bookings }));

app.get('/api/live-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const clientObj = { id: Date.now(), res };
    sseClients.push(clientObj);
    req.on('close', () => sseClients = sseClients.filter(c => c.res !== res));
});

app.post('/api/subscribe-push', (req, res) => {
    pushSubscriptions.push(req.body);
    res.status(201).json({ success: true });
});

app.get('/api/vapid-public-key', (req, res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' }));

// ------------------------------------------------------------------
// 5. SERVER STARTUP
// ------------------------------------------------------------------
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🚀 Anand Bus Transport System Running on Port ${PORT}`);
    console.log(`==================================================`);
    console.log(`🌐 Customer Website : http://localhost:${PORT}/`);
    console.log(`⚙️ Admin Dashboard  : http://localhost:${PORT}/admin/`);
    console.log(`==================================================\n`);
});