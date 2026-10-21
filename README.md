# Shree Vrundaban Residency — Hotel Website & Management System

> **A Peaceful Pilgrimage Retreat in the Heart of Puri, Odisha, India**  
> Located in Markandeshwer Sahi, Radhagovind Lane-2 (near Hanuman Temple), Puri, Odisha.

A complete, production-ready, mobile-friendly hotel web application and administrative management system built for **Shree Vrundaban Residency**. Features clean AC room presentations, real-time inquiry processing, a dynamic photo gallery, an interactive analytics dashboard with status distribution charts, and a production **PostgreSQL database** architecture (with automatic local SQLite fallback for development).

---

## 🌟 Key Features

### 🏨 Public Guest Experience
- **Authentic Coastal Pilgrimage Atmosphere**: Warm gold, deep maroon (`#420B13`), and soothing stone palette tailored for devotees visiting the sacred Shree Jagannath Temple and Puri Sea Beach.
- **Accommodations Showcase**: Displays Deluxe AC Rooms, Executive Family AC Suites, and Classic AC Rooms with occupancy details, bed types, verified amenities, and optional tariffs.
- **Interactive Photo Gallery**: Multi-category media gallery (Guest Rooms, Room Interiors, Hotel Exterior, Facilities, Nearby Attractions) with responsive grid, category filtering, and full-size image lightbox.
- **Direct Reservation Inquiries**: Real-time validated booking inquiry form with date-range selection, guest count, room preference, anti-spam honeypot protection, and instant database persistence.
- **Click-to-Call & Location**: Direct dial links for all hotel telephone numbers (`06752 464204`, `9437308353`, `9853111113`), verified WhatsApp coordination link, Google Maps embed, and turn-by-turn driving directions.

### 🛡️ Administrative Portal (`/admin`)
- **Protected Access**: Secure PBKDF2 (SHA-512) password hashing with cryptographic salt and token-based session authentication.
- **Visual Analytics & Status Distribution**: Interactive SVG Donut and Pie Chart displaying the live distribution of inquiries across all 5 operational phases:
  - 🟡 **New**: Awaiting staff response
  - 🔵 **Contacted**: Guest reached via phone or WhatsApp
  - 🟣 **In Progress**: Active room and date coordination
  - 🟢 **Confirmed**: Reserved stays for arriving devotees
  - ⚪ **Closed**: Completed or archived requests
- **Inquiry Management**: Search by guest name or phone, filter by status, review check-in/out dates, record private internal staff notes, change inquiry status, and export full records to CSV.
- **Photo Gallery Manager**: Upload high-resolution images directly from desktop or mobile devices with preview, custom captions, titles, categories, and one-click publish/unpublish toggling.
- **Room Catalog & Content Manager**: Edit descriptions, amenities, prices, hotel story, philosophy, verified contact numbers, and SEO meta tags with instant live updates.

---

## 🏗️ Technology Architecture

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Frontend UI** | React 19 + TypeScript | High-performance, declarative component architecture |
| **Styling** | Tailwind CSS v4 | Clean, responsive, mobile-first design |
| **Icons & Motion** | Lucide React + Motion | Lightweight icons and fluid transitions |
| **Backend API** | Node.js 22 LTS + Express | Robust REST API with parameterized routes and auth middleware |
| **Production Database** | PostgreSQL (`pg.Pool`) | Enterprise relational database with connection pooling, JSONB fields, indexes, and ACID guarantees |
| **Development Database** | SQLite (`node:sqlite`) | Automatic zero-config fallback for offline local development and preview environments |
| **Storage** | Persistent File System | Configurable media directory (`UPLOAD_DIR`) decoupled from application code |

---

## 📋 System Requirements

- **Node.js**: **Version 22.x LTS** or higher.
- **Database**: **PostgreSQL 15+ / 16+** in production (or built-in SQLite in local development).
- **RAM**: 1 GB minimum (2 GB recommended).
- **Disk**: 1 GB+ for OS, Node runtime, PostgreSQL data, and uploaded photographs.

---

## 🚀 Quickstart (Local Development)

### 1. Clone the Repository
```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/shree-vrundaban-residency.git
cd shree-vrundaban-residency
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup Environment Variables
```bash
cp .env.example .env
```
*(The default settings in `.env.example` run immediately in local development using the built-in SQLite engine. To connect to PostgreSQL locally, set `DATABASE_URL` in `.env`)*.

### 4. Initialize Database & Migrations
```bash
# Run schema migrations (automatically detects PostgreSQL or SQLite)
npm run db:migrate

# Setup administrator credentials
npm run db:seed-admin admin@hotel.com admin123456 "Residency Manager" super_admin
```

### 5. Launch Development Server
```bash
npm run dev
```

Open your browser:
- **Public Website**: [http://localhost:3000](http://localhost:3000)
- **Admin Dashboard**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **API Health Check**: [http://localhost:3000/api/health](http://localhost:3000/api/health)

**Default Admin Credentials**:
- **Email**: `admin@hotel.com`
- **Password**: `admin123456` *(change inside Admin Settings or via CLI)*

---

## 💾 Database Management & CLI Tools

All database interactions use parameterized SQL statements. The following npm scripts are provided:

| Command | Description |
| :--- | :--- |
| `npm run db:migrate` | Runs all pending SQL migrations sequentially against PostgreSQL or SQLite. |
| `npm run db:seed-admin` | Creates or updates an administrator account (`npm run db:seed-admin <email> <password> [name] [role]`). |
| `npm run db:backup` | Initiates database backup (native SQLite snapshot or `pg_dump` command for PostgreSQL). |
| `npm run db:restore <file>` | Restores the database from a specified backup file. |
| `npm test` | Runs the automated test suite verifying inquiry validation, date arithmetic, and business logic. |
| `npm run lint` | Runs TypeScript compiler checks (`tsc --noEmit`). |
| `npm run build` | Builds the client bundle for production into `dist/`. |

---

## 🔒 Security & Data Hygiene

- **Parameterization**: 100% of database queries use prepared statements with bound parameters (`$1, $2, ...` in PostgreSQL, `?, ...` in SQLite).
- **Git Hygiene**: `.gitignore` strictly excludes all database files (`*.sqlite*`, `*.db*`, `*.sql.gz`), uploaded guest media, local environment secrets (`.env`), and backup archives.
- **Authorization**: All administrative endpoints (`/api/inquiries`, `/api/rooms`, `/api/gallery`, `/api/hotel`, `/api/admin/*`) require a valid Bearer token.
- **CSRF & Honeypot**: The public reservation inquiry form includes honeypot detection to deflect automated bots without frustrating human visitors.

---

## 🌐 Production Deployment Guide

For full instructions on deploying to an Ubuntu/Debian VPS, setting up **PostgreSQL**, configuring **Systemd**, setting up **Nginx reverse proxy with Let's Encrypt SSL**, and establishing **zero-downtime upgrades for new GitHub releases**, please refer to:

👉 **[DEPLOYMENT.md](./DEPLOYMENT.md)**

---

## 📄 License & Attribution

- **Hotel Name**: Shree Vrundaban Residency, Puri, Odisha, India.
- **Proprietary Notice**: All rights reserved by Shree Vrundaban Residency.
- **Built for**: Pilgrims, families, and travelers visiting Puri Dham and Lord Jagannath Temple.
