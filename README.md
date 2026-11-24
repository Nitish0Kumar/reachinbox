# ReachInbox.ai

A full-stack **Email Scheduling & Campaign Management Platform** built as a company assignment.

> **Stack:** React · TypeScript · Vite · Tailwind CSS · Node.js · Express · PostgreSQL · Redis · BullMQ · Nodemailer

---

## ✨ Features

| Feature | Status |
|---|---|
| Professional SaaS Dashboard | ✅ |
| Campaign Creation (name, subject, body, sender, schedule) | ✅ |
| CSV / TXT recipient upload with validation & deduplication | ✅ |
| PostgreSQL campaign & recipient persistence | ✅ |
| Redis + BullMQ email job queue | ✅ |
| Hourly rate-limiting per sender (Redis INCR) | ✅ |
| Nodemailer + Ethereal SMTP email sending | ✅ |
| Multiple sender account management | ✅ |
| Scheduled / Sent / Failed campaign views | ✅ |
| Retry failed emails | ✅ |
| Bull Board queue monitor (`/admin/queues`) | ✅ |
| Slack webhook notification on rate-limit hit | ✅ (via SLACK_WEBHOOK_URL) |
| Google OAuth | ✅ (requires `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` in `.env`) |
| Elasticsearch search | 🔲 Planned (PostgreSQL ILIKE used as fallback) |

---

## 🗂 Project Structure

```
reachinbox/
├── frontend/           # React + Vite + Tailwind
│   └── src/
│       ├── App.tsx     # Main SPA — all pages
│       └── api.ts      # Typed fetch wrapper
└── backend/            # Express + TypeScript
    └── src/
        ├── server.ts           # All REST endpoints
        ├── config/
        │   ├── db.ts           # PostgreSQL pool
        │   └── schema.sql      # DB schema (run once)
        └── queues/
            ├── emailQueue.ts   # BullMQ queue + worker + rate-limiter
            └── scheduler.ts    # scheduleEmails() helper
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker Desktop (for PostgreSQL + Redis)

### 1. Start infrastructure
```bash
# PostgreSQL
docker run -d --name reachinbox-postgres \
  -e POSTGRES_USER=reachinbox \
  -e POSTGRES_PASSWORD=reachinbox_dev_password \
  -e POSTGRES_DB=reachinbox \
  -p 5432:5432 \
  -v reachinbox_pgdata:/var/lib/postgresql/data \
  postgres:16

# Redis
docker run -d --name reachinbox-redis \
  -p 6379:6379 \
  -v reachinbox_redisdata:/data \
  redis:7
```

### 2. Apply DB schema
```bash
docker exec -i reachinbox-postgres psql -U reachinbox -d reachinbox \
  < reachinbox/backend/src/config/schema.sql
```

### 3. Backend
```bash
cd reachinbox/backend
cp .env.example .env     # fill in real SMTP creds or leave blank for Ethereal auto-account
npm install
npm run dev              # → http://localhost:5001
```

### 4. Frontend
```bash
cd reachinbox/frontend
npm install
npm run dev              # → http://localhost:5173
```

---

## 🔑 Environment Variables

See [`backend/.env.example`](backend/.env.example).  
**Never commit `.env` to Git.**

---

## 📡 API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/stats` | Dashboard stats |
| GET | `/api/campaigns` | List campaigns (`?status=&search=`) |
| POST | `/api/campaigns` | Create campaign + schedule jobs |
| GET | `/api/campaigns/:id` | Get single campaign |
| DELETE | `/api/campaigns/:id` | Delete campaign |
| GET | `/api/campaigns/:id/recipients` | List recipients for campaign |
| POST | `/api/campaigns/:id/retry-failed` | Retry failed recipients |
| GET | `/api/recipients` | List recipients (`?status=&campaign_id=`) |
| GET | `/api/senders` | List senders |
| POST | `/api/senders` | Add sender |
| DELETE | `/api/senders/:id` | Delete sender |
| POST | `/api/test-email` | Send a test email, returns Ethereal preview URL |
| GET | `/admin/queues` | Bull Board (requires `Authorization: Bearer <ADMIN_TOKEN>`) |

---

## ⚙️ Architecture

```
Browser → React (Vite)
            ↓ fetch
       Express API (Node.js)
        ├─ PostgreSQL (campaigns, recipients, senders)
        └─ Redis
             └─ BullMQ
                  └─ Email Worker
                       ├─ Hourly rate-limit (Redis INCR)
                       ├─ Nodemailer → Ethereal / real SMTP
                       ├─ Slack notification on limit hit
                       └─ Update recipient status in DB
```

---

## ✅ Email Queue Flow

1. User creates campaign via UI
2. Backend inserts campaign + recipients into PostgreSQL
3. `scheduleEmails()` adds one BullMQ job per recipient with the correct `delay` (scheduled_at − now + index × delay_seconds)
4. Worker checks Redis hourly counter for the sender
5. If limit exceeded → job is re-enqueued with delay until next hour boundary + Slack notification sent
6. Otherwise → email sent via Nodemailer, recipient status updated to `sent` or `failed`
7. When all recipients finish → campaign status updated

---

## 🧪 Known Limitations

- Elasticsearch not implemented; PostgreSQL `ILIKE` used for search
- Google OAuth requires configuring `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env`
- SMTP credentials stored in `.env` only — not encrypted at rest
- Single-workspace MVP (campaigns are not scoped per logged-in user yet)
- Hourly rate-limit counter resets at clock-hour boundaries (not rolling window)

---

## 🌐 Deployment Guide

### Option A — Railway (Recommended, Free Tier)

Railway hosts your backend + PostgreSQL + Redis all in one place. Frontend goes on Vercel.

#### Step 1 — Deploy Backend on Railway

1. Go to **[railway.app](https://railway.app)** → sign in with GitHub
2. Click **New Project → Deploy from GitHub repo** → select `reachinbox`
3. Choose the **`backend`** folder as root
4. Railway auto-detects Node.js and runs `npm run build && npm start`
5. Add these environment variables in Railway dashboard (Settings → Variables):

```env
DATABASE_URL=<auto-filled by Railway PostgreSQL plugin>
REDIS_URL=<auto-filled by Railway Redis plugin>
PORT=5001
SESSION_SECRET=some-random-secret-string
ADMIN_TOKEN=reachinbox-admin
NODE_ENV=production
```

6. Click **+ New** → **Database → PostgreSQL** → Railway links it automatically
7. Click **+ New** → **Database → Redis** → Railway links it automatically
8. After deploy, copy your backend URL e.g. `https://reachinbox-backend.up.railway.app`
9. Apply DB schema once:
   ```bash
   # In Railway dashboard → PostgreSQL → Connect → open shell, then:
   psql $DATABASE_URL < backend/src/config/schema.sql
   ```

#### Step 2 — Deploy Frontend on Vercel

1. Go to **[vercel.com](https://vercel.com)** → New Project → Import `reachinbox` from GitHub
2. Set **Root Directory** to `frontend`
3. Add environment variable:
   ```env
   VITE_API_URL=https://your-railway-backend-url.up.railway.app
   ```
4. Click **Deploy** → Vercel builds and hosts at `https://reachinbox.vercel.app`

> [!IMPORTANT]
> After getting your Vercel URL, go back to Railway backend variables and add:
> ```
> FRONTEND_URL=https://reachinbox.vercel.app
> ```
> Then redeploy backend so CORS allows your Vercel domain.

---

### Option B — Render (Alternative Free Hosting)

| Service | Platform | Plan |
|---|---|---|
| Backend (Node.js) | [render.com](https://render.com) → Web Service | Free |
| PostgreSQL | Render → PostgreSQL | Free (90 days) |
| Redis | [Upstash](https://upstash.com) | Free (10k req/day) |
| Frontend | [Vercel](https://vercel.com) | Free |

**Backend `render.yaml`** (place in `/backend`):
```yaml
services:
  - type: web
    name: reachinbox-backend
    env: node
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: reachinbox-db
          property: connectionString
databases:
  - name: reachinbox-db
    plan: free
```

---

### Option C — VPS / Local Server (Full Control)

```bash
# On your server (Ubuntu):
git clone https://github.com/Nitish0Kumar/reachinbox.git
cd reachinbox

# Start PostgreSQL + Redis
docker compose up -d   # or use docker run commands from Quick Start

# Backend
cd backend && cp .env.example .env  # fill real values
npm install && npm run build
npm start  # runs on port 5001

# Frontend (build static files)
cd ../frontend && npm install
npm run build  # outputs to dist/
# Serve dist/ with nginx or: npx serve dist
```

---

### 🔧 Frontend API URL Config

In `frontend/src/api.ts`, the base URL defaults to `http://localhost:5001`.  
For production, set the `VITE_API_URL` env var before building:

```bash
VITE_API_URL=https://your-backend.up.railway.app npm run build
```

---

## 📸 Screenshots

> _Add screenshots of the dashboard, campaign creation modal, and Bull Board here._

---

## 👤 Author

Nitish Kumar — Company Assignment Submission

