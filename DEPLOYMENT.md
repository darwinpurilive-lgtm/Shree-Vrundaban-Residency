# Production Deployment & Hosting Guide
## Shree Vrundaban Residency (Puri, Odisha)

This production manual documents how to deploy **Shree Vrundaban Residency** to an always-on Linux server (Ubuntu 22.04/24.04 LTS, Debian, or equivalent VPS like DigitalOcean, Linode, AWS EC2, or Hetzner) with a **permanent PostgreSQL database** and **persistent media storage**.

---

## 1. Production Architecture Overview

```
+---------------------------------------------------------------------------------+
|                                 CLIENT BROWSERS                                 |
+---------------------------------------------------------------------------------+
                                       |
                                HTTPS (Port 443)
                                       v
+---------------------------------------------------------------------------------+
|                        NGINX REVERSE PROXY & SSL (Certbot)                      |
|           Direct static serving for /uploads/, rate limiting, Gzip compression  |
+---------------------------------------------------------------------------------+
                                       |
                              Reverse Proxy (Port 3000)
                                       v
+---------------------------------------------------------------------------------+
|               EXPRESS + REACT FULL-STACK APPLICATION (Node.js 22)                |
|                    Managed by Systemd (Process Supervisor)                      |
+---------------------------------------------------------------------------------+
          |                                                   |
          | Parameterized SQL Queries (pg.Pool)               | Media File Uploads
          v                                                   v
+------------------------------------+             +------------------------------+
|    PRODUCTION POSTGRESQL CLUSTER   |             |    PERSISTENT UPLOADS DISK   |
|   Self-managed or Managed Database |             | /var/lib/shree-vrundaban/uploads |
+------------------------------------+             +------------------------------+
          |
     Nightly pg_dump
          v
+------------------------------------+
|       POINT-IN-TIME BACKUPS        |
| /var/backups/shree-vrundaban/*.sql |
+------------------------------------+
```

### Decoupling Code from Persistent State
To guarantee that Git pulls, frontend rebuilds, and GitHub releases **never overwrite or reset guest inquiries, hotel details, administrator accounts, or uploaded photographs**:
- **Application Code**: `/opt/shree-vrundaban` (version-controlled via Git)
- **Production PostgreSQL Database**: Self-managed PostgreSQL cluster or managed PostgreSQL instance
- **Persistent Media Uploads**: `/var/lib/shree-vrundaban/uploads` (outside the Git repository)
- **Database Backups**: `/var/backups/shree-vrundaban`

---

## 2. Server Requirements

- **Operating System**: Ubuntu 22.04 LTS / 24.04 LTS (or Debian 12)
- **Hardware**: Minimum 1 vCPU, 1 GB RAM (2 GB recommended for high pilgrimage season traffic)
- **Software**: Node.js **22.x LTS** or newer, PostgreSQL **15+ / 16+**, Nginx, Certbot
- **Domain**: Registered domain with DNS A-records pointing to server IP (e.g., `hotelvrundabanpuri.com`)

---

## 3. Server Setup & Dependencies Installation

Log in as `root` or a `sudo` user:

```bash
# 1. Update system packages
sudo apt update && sudo apt upgrade -y

# 2. Install essential tools, Nginx, Certbot, and PostgreSQL
sudo apt install -y curl git ufw nginx certbot python3-certbot-nginx postgresql postgresql-contrib

# 3. Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 4. Verify Node.js and PostgreSQL versions
node -v   # Expected: v22.x
psql -V   # Expected: psql (PostgreSQL) 15.x or 16.x
```

---

## 4. PostgreSQL Database Provisioning

### Option A: Self-Managed PostgreSQL on the Same VPS

1. Connect to PostgreSQL:
```bash
sudo -u postgres psql
```

2. Create the production database and user:
```sql
CREATE USER hoteladmin WITH PASSWORD 'ChangeThisToYourStrongPassword2026!';
CREATE DATABASE shree_vrundaban_db OWNER hoteladmin;
GRANT ALL PRIVILEGES ON DATABASE shree_vrundaban_db TO hoteladmin;
\q
```

### Option B: Managed PostgreSQL (Supabase / Neon / AWS RDS)
Create a new PostgreSQL project on Supabase or Neon and obtain your connection string:
```
postgresql://postgres.xxx:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

---

## 5. Storage Directories & Application User

Create a dedicated non-privileged user and persistent media directory:

```bash
# 1. Create system user
sudo useradd -r -m -d /opt/shree-vrundaban -s /bin/bash hotelapp

# 2. Create persistent uploads and backups directories
sudo mkdir -p /var/lib/shree-vrundaban/uploads
sudo mkdir -p /var/backups/shree-vrundaban

# 3. Set ownership
sudo chown -R hotelapp:hotelapp /var/lib/shree-vrundaban
sudo chown -R hotelapp:hotelapp /var/backups/shree-vrundaban

# 4. Restrict permissions
sudo chmod 750 /var/lib/shree-vrundaban
sudo chmod 750 /var/backups/shree-vrundaban
```

---

## 6. Deploy Code & Run Migrations

Switch to the `hotelapp` user:

```bash
sudo -u hotelapp -i
cd /opt/shree-vrundaban

# 1. Clone repository
git clone https://github.com/YOUR_GITHUB_USERNAME/shree-vrundaban-residency.git .

# 2. Checkout latest stable release
git checkout $(git describe --tags $(git rev-list --tags --max-count=1))

# 3. Install production dependencies
npm install

# 4. Create production .env file
cp .env.example .env
```

### Edit `/opt/shree-vrundaban/.env` (`nano .env`):
```ini
PORT=3000
NODE_ENV=production

# Production PostgreSQL Connection URL
DATABASE_URL=postgresql://hoteladmin:ChangeThisToYourStrongPassword2026!@localhost:5432/shree_vrundaban_db

# Supabase Storage Configuration (for cloud media bucket)
SUPABASE_URL=https://xfwkpaviggxhoonsptdg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Persistent Local Disk Uploads Directory (fallback)
UPLOAD_DIR=/var/lib/shree-vrundaban/uploads
BACKUP_DIR=/var/backups/shree-vrundaban

# Administrator Setup
ADMIN_INITIAL_EMAIL=admin@hotel.com
ADMIN_INITIAL_PASSWORD=YourStrongUniquePasswordHere!

APP_URL=https://hotelvrundabanpuri.com
```

### Build & Migrate:
```bash
# 1. Build client assets
npm run build

# 2. Run PostgreSQL migrations
npm run db:migrate

# 3. Bootstrap production administrator account
npm run db:seed-admin admin@hotel.com "YourStrongUniquePasswordHere!" "General Manager" super_admin

# Exit back to root
exit
```

---

## 7. Systemd Service (Process Supervision & Auto-Restart)

Create `/etc/systemd/system/shree-vrundaban.service`:

```bash
sudo nano /etc/systemd/system/shree-vrundaban.service
```

Paste the following:

```ini
[Unit]
Description=Shree Vrundaban Residency Hotel Service
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=hotelapp
Group=hotelapp
WorkingDirectory=/opt/shree-vrundaban
EnvironmentFile=/opt/shree-vrundaban/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=shree-vrundaban

# Security sandboxing
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/var/lib/shree-vrundaban /var/backups/shree-vrundaban /opt/shree-vrundaban

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable shree-vrundaban
sudo systemctl start shree-vrundaban
sudo systemctl status shree-vrundaban
```

---

## 8. Nginx Reverse Proxy & Let's Encrypt SSL

Create `/etc/nginx/sites-available/shree-vrundaban`:

```bash
sudo nano /etc/nginx/sites-available/shree-vrundaban
```

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name hotelvrundabanpuri.com www.hotelvrundabanpuri.com;

    client_max_body_size 25M;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript image/svg+xml;

    # Serve uploaded hotel imagery directly through Nginx
    location /uploads/ {
        alias /var/lib/shree-vrundaban/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
        access_log off;
    }

    # Proxy application requests to Node.js backend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site and configure SSL:
```bash
sudo ln -s /etc/nginx/sites-available/shree-vrundaban /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# Issue free Let's Encrypt SSL certificate
sudo certbot --nginx -d hotelvrundabanpuri.com -d www.hotelvrundabanpuri.com
```

---

## 9. Automated Nightly Database Backups

Setup a daily cron job to create timestamped PostgreSQL dumps:

```bash
sudo crontab -u hotelapp -e
```

Add the backup schedule (runs every night at 2:00 AM):
```cron
0 2 * * * pg_dump "postgresql://hoteladmin:ChangeThisToYourStrongPassword2026!@localhost:5432/shree_vrundaban_db" | gzip > /var/backups/shree-vrundaban/hotel_db_$(date +\%F_\%H\%M).sql.gz
# Delete backups older than 30 days
30 2 * * * find /var/backups/shree-vrundaban/ -name "hotel_db_*.sql.gz" -type f -mtime +30 -delete
```

---

## 10. Deploying New GitHub Releases (Zero Downtime & Safe Upgrades)

When releasing an update on GitHub, execute the following sequence:

```bash
sudo -u hotelapp -i
cd /opt/shree-vrundaban

# 1. Fetch tags and switch to new release
git fetch --tags
git checkout v1.2.0 # (replace with your release version)

# 2. Update dependencies and build
npm install --omit=dev
npm run build

# 3. Run any newly added migrations
npm run db:migrate

exit

# 4. Restart service
sudo systemctl restart shree-vrundaban
```

Because the database resides in PostgreSQL and media is in `/var/lib/shree-vrundaban/uploads`, all existing inquiries, rooms, and photos remain completely intact.

---

## 11. Production Health & Verification

1. **Health Endpoint**: `curl https://hotelvrundabanpuri.com/api/health`
   - Should return HTTP 200 with `status: healthy` and `database: postgresql`.
2. **Inquiry Flow**: Submit a test inquiry on the homepage and verify confirmation.
3. **Admin Dashboard**: Log in at `/admin`, verify the **Inquiry Status Distribution** pie chart.
4. **Media Upload**: Upload a photo in Gallery Management; verify it appears on the public gallery and loads from `/uploads/...`.
