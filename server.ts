import express, { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './src/server/db.ts';
import { storage } from './src/server/storage/storage-service.ts';
import {
  validateInquiry,
  convertInquiriesToCsv,
  isRoomAvailableForDates,
  calculateBookingBreakdown,
  calculateStayNights,
  generateGuestBookingEmailHtml,
  generateHotelBookingEmailHtml,
} from './src/lib/hotel-logic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Production Security Headers
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Production-Safe CORS Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Body parsers (up to 25MB for high-resolution gallery photo uploads)
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Static uploads directory (configured through UPLOAD_DIR)
const rawUploads = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'public', 'uploads');
const uploadsDir = path.isAbsolute(rawUploads) ? rawUploads : path.resolve(process.cwd(), rawUploads);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// System Health Check Endpoint
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    const dbHealth = await db.getHealth();
    const hotel = await db.getHotel();
    res.json({
      status: 'healthy',
      service: 'Shree Vrundaban Residency API',
      hotel: hotel.name,
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      database: dbHealth,
      storage: storage.getStatus(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      error: (err as Error).message,
    });
  }
});

// Auth Middleware
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication token required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const user = await db.verifySession(token);
    if (!user) {
      return res.status(401).json({ error: 'Session expired or invalid token. Please log in again.' });
    }

    (req as any).adminUser = user;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Session verification failure' });
  }
}

// -------------------------------------------------------------
// Authentication Endpoints
// -------------------------------------------------------------

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const authResult = await db.authenticateAdmin(email, password);
    if (!authResult) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({
      success: true,
      token: authResult.token,
      user: {
        id: authResult.user.id,
        email: authResult.user.email,
        name: authResult.user.name,
        role: authResult.user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Authentication service failure' });
  }
});

app.get('/api/auth/me', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const user = await db.verifySession(token);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Session verification error' });
  }
});

app.post('/api/auth/logout', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    await db.logoutSession(token);
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

app.post('/api/auth/change-password', requireAdmin, async (req: Request, res: Response) => {
  const user = (req as any).adminUser;
  const { newPassword, currentPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }

  const check = await db.authenticateAdmin(user.email, currentPassword);
  if (!check) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const success = await db.changeAdminPassword(user.id, newPassword);
  if (success) {
    return res.json({ success: true, message: 'Password updated successfully' });
  }
  res.status(500).json({ error: 'Failed to update password' });
});

// -------------------------------------------------------------
// Hotel Details Endpoints
// -------------------------------------------------------------

app.get('/api/hotel', async (_req: Request, res: Response) => {
  try {
    const hotel = await db.getHotel();
    res.json(hotel);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve hotel details' });
  }
});

app.put('/api/hotel', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    const updated = await db.updateHotel(updates);
    res.json({ success: true, hotel: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update hotel details' });
  }
});

// -------------------------------------------------------------
// Rooms Endpoints
// -------------------------------------------------------------

app.get('/api/rooms', async (req: Request, res: Response) => {
  try {
    let isAdmin = false;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      const token = req.headers.authorization.split(' ')[1];
      const verified = await db.verifySession(token);
      isAdmin = !!verified;
    }
    const rooms = await db.getRooms(!isAdmin);
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve rooms' });
  }
});

app.get('/api/rooms/:id', async (req: Request, res: Response) => {
  try {
    const room = await db.getRoomById(req.params.id);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.json(room);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching room' });
  }
});

app.post('/api/rooms', requireAdmin, async (req: Request, res: Response) => {
  const { name, category, description, shortDescription, capacity, bedType, sizeSqFt, pricePerNight, currency, amenities, images, featuredImage, isPublished } = req.body;

  if (!name || !category || !description) {
    return res.status(400).json({ error: 'Room name, category, and description are required' });
  }

  try {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const existingRooms = await db.getRooms(false);
    const displayOrder = existingRooms.length + 1;

    const room = await db.addRoom({
      name,
      slug,
      category,
      description,
      shortDescription: shortDescription || description.slice(0, 120),
      capacity: Number(capacity) || 2,
      bedType: bedType || 'King Bed',
      sizeSqFt: Number(sizeSqFt) || 500,
      pricePerNight: pricePerNight !== undefined ? Number(pricePerNight) : undefined,
      currency: currency || 'INR',
      amenities: Array.isArray(amenities) ? amenities : (amenities ? amenities.split(',').map((s: string) => s.trim()) : []),
      images: Array.isArray(images) && images.length > 0 ? images : [featuredImage || '/uploads/default-room.jpg'],
      featuredImage: featuredImage || (Array.isArray(images) && images[0]) || '/uploads/default-room.jpg',
      displayOrder,
      isPublished: isPublished !== undefined ? Boolean(isPublished) : true,
    });

    res.status(201).json({ success: true, room });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Failed to create room' });
  }
});

app.put('/api/rooms/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = await db.updateRoom(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.json({ success: true, room: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update room' });
  }
});

app.delete('/api/rooms/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const deleted = await db.deleteRoom(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.json({ success: true, message: 'Room deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

app.patch('/api/rooms/reorder', requireAdmin, async (req: Request, res: Response) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'orderedIds array required' });
  }
  try {
    const rooms = await db.reorderRooms(orderedIds);
    res.json({ success: true, rooms });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder rooms' });
  }
});

// -------------------------------------------------------------
// Gallery Endpoints
// -------------------------------------------------------------

app.get('/api/gallery', async (req: Request, res: Response) => {
  try {
    let isAdmin = false;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      const token = req.headers.authorization.split(' ')[1];
      const verified = await db.verifySession(token);
      isAdmin = !!verified;
    }
    const images = await db.getGallery(!isAdmin);
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve gallery' });
  }
});

app.post('/api/gallery', requireAdmin, async (req: Request, res: Response) => {
  const { url, title, caption, altText, category, isPublished } = req.body;
  if (!url || !title) {
    return res.status(400).json({ error: 'Image URL and title are required' });
  }

  try {
    const existing = await db.getGallery(false);
    const displayOrder = existing.length + 1;

    const image = await db.addGalleryImage({
      url,
      title,
      caption: caption || '',
      altText: altText || title,
      category: category || 'Guest Rooms',
      displayOrder,
      isPublished: isPublished !== undefined ? Boolean(isPublished) : true,
    });

    res.status(201).json({ success: true, image });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add gallery image' });
  }
});

app.put('/api/gallery/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = await db.updateGalleryImage(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.json({ success: true, image: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update image' });
  }
});

app.delete('/api/gallery/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const existing = await db.getGalleryImageById(req.params.id);
    const deleted = await db.deleteGalleryImage(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Image not found' });
    }
    if (existing?.url) {
      await storage.deleteImage(existing.url);
    }
    res.json({ success: true, message: 'Image deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

app.patch('/api/gallery/reorder', requireAdmin, async (req: Request, res: Response) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'orderedIds array required' });
  }
  try {
    const gallery = await db.reorderGallery(orderedIds);
    res.json({ success: true, gallery });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder gallery' });
  }
});

// -------------------------------------------------------------
// Image File Upload Endpoint (Supabase Storage with Disk Fallback)
// -------------------------------------------------------------

app.post('/api/upload', requireAdmin, async (req: Request, res: Response) => {
  const { fileData, fileName, folder } = req.body;
  if (!fileData) {
    return res.status(400).json({ error: 'No file data received' });
  }

  try {
    const result = await storage.uploadImage(fileData, fileName, folder || 'gallery');
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message || 'Failed to upload image' });
  }
});

// -------------------------------------------------------------
// Inquiries Endpoints
// -------------------------------------------------------------

// Public Guest Submission
app.post('/api/inquiries', async (req: Request, res: Response) => {
  const validation = validateInquiry(req.body);
  if (!validation.isValid) {
    return res.status(400).json({
      error: 'Please correct the errors in the form',
      validationErrors: validation.errors,
    });
  }

  const {
    guestName,
    email,
    phone,
    checkInDate,
    checkOutDate,
    guestsCount,
    roomPreference,
    message,
  } = req.body;

  try {
    const inquiry = await db.addInquiry({
      guestName: guestName.trim(),
      email: (email || '').trim().toLowerCase(),
      phone: phone.trim(),
      checkInDate,
      checkOutDate,
      guestsCount: Number(guestsCount),
      roomPreference: roomPreference || 'Deluxe AC Room',
      message: (message || '').trim(),
    });

    res.status(201).json({
      success: true,
      message: 'Your inquiry has been received. Our team at Shree Vrundaban Residency will contact you shortly.',
      inquiry: {
        id: inquiry.id,
        guestName: inquiry.guestName,
        createdAt: inquiry.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record reservation inquiry' });
  }
});

// Admin Inquiries List
app.get('/api/inquiries', requireAdmin, async (req: Request, res: Response) => {
  try {
    const inquiries = await db.getInquiries();
    res.json(inquiries);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve inquiries' });
  }
});

// Admin Inquiry by ID
app.get('/api/inquiries/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const inquiry = await db.getInquiryById(req.params.id);
    if (!inquiry) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }
    res.json(inquiry);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching inquiry details' });
  }
});

// Admin Update Inquiry (status, internal notes)
app.patch('/api/inquiries/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = await db.updateInquiry(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }
    res.json({ success: true, inquiry: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update inquiry' });
  }
});

// Admin Delete Inquiry
app.delete('/api/inquiries/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const deleted = await db.deleteInquiry(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }
    res.json({ success: true, message: 'Inquiry deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete inquiry' });
  }
});

// Admin Export Inquiries as CSV
app.get('/api/inquiries-export', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const inquiries = await db.getInquiries();
    const csvData = convertInquiriesToCsv(inquiries);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="hotel_inquiries_${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(csvData);
  } catch (err) {
    res.status(500).send('Error generating CSV export');
  }
});

// -------------------------------------------------------------
// Direct Booking Endpoints
// -------------------------------------------------------------

app.post('/api/bookings/check-availability', async (req: Request, res: Response) => {
  const { checkInDate, checkOutDate, roomId } = req.body;
  if (!checkInDate || !checkOutDate) {
    return res.status(400).json({ error: 'Check-in and check-out dates are required' });
  }

  try {
    const allBookings = await db.getBookings();
    const rooms = await db.getRooms(true);

    if (roomId) {
      const isAvail = isRoomAvailableForDates(roomId, checkInDate, checkOutDate, allBookings);
      return res.json({
        roomId,
        available: isAvail,
      });
    }

    const availabilityMap = rooms.map((r) => ({
      roomId: r.id,
      name: r.name,
      category: r.category,
      pricePerNight: r.pricePerNight,
      available: isRoomAvailableForDates(r.id, checkInDate, checkOutDate, allBookings),
    }));

    res.json({
      checkInDate,
      checkOutDate,
      rooms: availabilityMap,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error checking availability' });
  }
});

app.post('/api/bookings', async (req: Request, res: Response) => {
  const {
    roomId,
    checkInDate,
    checkOutDate,
    guestsCount,
    guestName,
    email,
    phone,
    paymentMethod,
    cardLast4,
    cardBrand,
    upiId,
    specialRequests,
  } = req.body;

  if (!roomId || !checkInDate || !checkOutDate || !guestName || !email || !phone) {
    return res.status(400).json({ error: 'Please provide all required guest and accommodation details' });
  }

  try {
    const room = await db.getRoomById(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Selected accommodation could not be found' });
    }

    const allBookings = await db.getBookings();
    const available = isRoomAvailableForDates(roomId, checkInDate, checkOutDate, allBookings);
    if (!available) {
      return res.status(409).json({
        error:
          'This accommodation has just been reserved for those dates by another guest. Please select alternative dates or suites.',
      });
    }

    const nights = calculateStayNights(checkInDate, checkOutDate);
    if (nights <= 0) {
      return res.status(400).json({ error: 'Check-out date must be after check-in date' });
    }

    const rate = room.pricePerNight || 1500;
    const breakdown = calculateBookingBreakdown(rate, nights, 12, 5);
    const hotel = await db.getHotel();

    const randomRefNum = Math.floor(1000 + Math.random() * 9000);
    const bookingReference = `SVR-BK-${randomRefNum}`;
    const transactionId = `TXN-PURI-${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;

    const guestEmailHtml = generateGuestBookingEmailHtml({
      bookingReference,
      transactionId,
      guestName: guestName.trim(),
      roomName: room.name,
      roomCategory: room.category,
      checkInDate,
      checkOutDate,
      nights: breakdown.nights,
      guestsCount: Number(guestsCount) || 2,
      totalAmount: breakdown.totalAmount,
      currency: room.currency || 'INR',
      paymentMethod: paymentMethod || 'card',
      cardLast4: cardLast4 || '4242',
      hotelName: hotel.name,
      hotelAddress: hotel.address,
      hotelPhone: hotel.phone,
      checkInTime: hotel.checkInTime,
      checkOutTime: hotel.checkOutTime,
    });

    const hotelEmailHtml = generateHotelBookingEmailHtml({
      bookingReference,
      transactionId,
      guestName: guestName.trim(),
      guestEmail: email.trim().toLowerCase(),
      guestPhone: phone.trim(),
      roomName: room.name,
      checkInDate,
      checkOutDate,
      nights: breakdown.nights,
      guestsCount: Number(guestsCount) || 2,
      totalAmount: breakdown.totalAmount,
      currency: room.currency || 'INR',
      specialRequests,
    });

    const nowIso = new Date().toISOString();

    const booking = await db.addBooking({
      bookingReference,
      roomId: room.id,
      roomName: room.name,
      roomCategory: room.category,
      roomImage: room.featuredImage,
      guestName: guestName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      checkInDate,
      checkOutDate,
      nights: breakdown.nights,
      guestsCount: Number(guestsCount) || 2,
      roomRatePerNight: rate,
      subtotal: breakdown.subtotal,
      taxAmount: breakdown.taxAmount,
      serviceFee: breakdown.serviceFee,
      totalAmount: breakdown.totalAmount,
      currency: room.currency || 'INR',
      status: 'Confirmed',
      payment: {
        transactionId,
        method: paymentMethod || 'card',
        cardLast4: cardLast4 || '4242',
        cardBrand: cardBrand || 'Visa Platinum',
        upiId: upiId || undefined,
        status: 'Paid',
        paidAt: nowIso,
        amount: breakdown.totalAmount,
        currency: room.currency || 'INR',
      },
      specialRequests: specialRequests ? specialRequests.trim() : undefined,
      emailsSent: [
        {
          id: `email-guest-${Date.now()}`,
          to: email.trim().toLowerCase(),
          recipientRole: 'guest',
          subject: `Reservation Voucher & Confirmation - ${bookingReference}`,
          htmlContent: guestEmailHtml,
          sentAt: nowIso,
        },
        {
          id: `email-hotel-${Date.now()}`,
          to: hotel.email,
          recipientRole: 'hotel',
          subject: `New Paid Direct Booking Alert - ${bookingReference}`,
          htmlContent: hotelEmailHtml,
          sentAt: nowIso,
        },
      ],
    });

    res.status(201).json({
      success: true,
      message: 'Your payment was authorized and your room is guaranteed.',
      booking,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process booking' });
  }
});

app.get('/api/bookings', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const bookings = await db.getBookings();
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve bookings' });
  }
});

app.get('/api/bookings/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const booking = await db.getBookingById(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking record not found' });
    }
    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

app.patch('/api/bookings/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const updated = await db.updateBooking(req.params.id, { status });
    if (!updated) {
      return res.status(404).json({ error: 'Booking record not found' });
    }
    res.json({ success: true, booking: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update booking status' });
  }
});

app.delete('/api/bookings/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const deleted = await db.deleteBooking(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Booking record not found' });
    }
    res.json({ success: true, message: 'Booking removed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// Admin Dashboard Stats
app.get('/api/admin/stats', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute dashboard stats' });
  }
});

// Admin Reset Data (Protected with production safety lock)
app.post('/api/admin/reset', requireAdmin, async (req: Request, res: Response) => {
  const user = (req as any).adminUser;
  if (user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden: Super administrator privilege required' });
  }

  if (isProduction && req.body?.confirmPhrase !== 'PURGE_AND_RESET_TO_SEED') {
    return res.status(400).json({
      error: 'Production safety lock active. You must pass { confirmPhrase: "PURGE_AND_RESET_TO_SEED" } to proceed.',
    });
  }

  try {
    await db.resetToInitial();
    res.json({ success: true, message: 'Database reset to initial hotel state.' });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

// -------------------------------------------------------------
// Vite Middleware / Static Serving Setup
// -------------------------------------------------------------

async function startServer() {
  // Ensure default admin user is initialized
  try {
    await db.ensureDefaultAdmin();
  } catch (err) {
    console.warn('[Admin Setup] Initial check note:', (err as Error).message);
  }

  if (!isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Hotel website & Admin portal running on http://localhost:${PORT}`);
    console.log(`[Storage] Uploads directory active at: ${uploadsDir}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
