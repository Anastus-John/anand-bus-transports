require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

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
// 2. CONFIGURATION: DATABASE (SUPABASE POSTGRESQL), EMAIL & WEB PUSH
// ------------------------------------------------------------------
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

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

// Memory stores for real-time clients and Web Push subscriptions
let pushSubscriptions = [];
let sseClients = [];

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
            <p><strong>Date & Time:</strong> ${booking.dateTime || booking.date_time}</p>
            <p><strong>Passengers:</strong> ${booking.passengers}</p>
            <p><a href="${booking.whatsappLink || booking.whatsapp_link}">💬 Chat on WhatsApp</a></p>
        `
    };

    try {
        await transporter.sendMail(ownerMail);
    } catch (err) {
        console.error('❌ Email Error:', err.message);
    }
}

// ------------------------------------------------------------------
// 3. API ENDPOINTS
// ------------------------------------------------------------------

// POST: Create New Booking in Supabase Cloud DB
app.post('/api/bookings', async (req, res) => {
    try {
        const { name, phone, email, pickup, destination, dateTime, passengers, budget, notes } = req.body;
        if (!name || !phone || !pickup || !destination || !dateTime) {
            return res.status(400).json({ success: false, message: 'Missing fields' });
        }

        const cleanPhone = phone.replace(/[^0-9]/g, '');
        const bookingId = 'AB-' + Date.now().toString().slice(-6);
        const whatsappText = encodeURIComponent(`Hello ${name}, thank you for inquiring with Anand Bus Transports for your trip from ${pickup} to ${destination} on ${dateTime}.`);
        const whatsappLink = `https://wa.me/91${cleanPhone}?text=${whatsappText}`;

        const insertQuery = `
            INSERT INTO bookings (id, name, phone, email, pickup, destination, date_time, passengers, budget, notes, whatsapp_link, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *;
        `;
        const values = [
            bookingId, 
            name, 
            cleanPhone, 
            email || 'N/A', 
            pickup, 
            destination, 
            dateTime, 
            parseInt(passengers), 
            budget || 'Negotiable', 
            notes || '', 
            whatsappLink, 
            'PENDING_QUOTE'
        ];
        
        const result = await pool.query(insertQuery, values);
        const newBooking = result.rows[0];

        // 1. Broadcast to SSE connected admin clients
        sseClients.forEach(c => c.res.write(`data: ${JSON.stringify(newBooking)}\n\n`));

        // 2. Trigger Web Push Notifications
        pushSubscriptions.forEach(sub => {
            webpush.sendNotification(sub, JSON.stringify({
                title: '🚨 NEW BUS BOOKING RECEIVED!',
                body: `${name} | ${pickup} ➔ ${destination}`,
                data: { bookingId: newBooking.id }
            })).catch(() => {});
        });

        // 3. Trigger Email Alerts
        sendEmailNotifications(newBooking);

        return res.status(201).json({ success: true, booking: newBooking });
    } catch (err) {
        console.error('Database Error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
    }
});

// GET: Fetch All Bookings from Supabase Cloud DB
app.get('/api/bookings', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM bookings ORDER BY created_at DESC');
        return res.json({ success: true, count: result.rows.length, bookings: result.rows });
    } catch (err) {
        console.error('Fetch Error:', err);
        return res.status(500).json({ success: false, message: 'Database query error' });
    }
});

// GET: Real-time Server-Sent Events (SSE) Stream
app.get('/api/live-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const clientObj = { id: Date.now(), res };
    sseClients.push(clientObj);
    req.on('close', () => sseClients = sseClients.filter(c => c.res !== res));
});

// POST: Subscribe Admin Device to Web Push Notifications
app.post('/api/subscribe-push', (req, res) => {
    pushSubscriptions.push(req.body);
    res.status(201).json({ success: true });
});

// GET: Provide VAPID Public Key to Frontend
app.get('/api/vapid-public-key', (req, res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' }));

// ------------------------------------------------------------------
// 4. SERVER STARTUP
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