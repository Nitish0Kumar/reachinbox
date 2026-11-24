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

## 📸 Screenshots

> _Add screenshots of the dashboard, campaign creation modal, and Bull Board here._

---

## 👤 Author

Nitish Kumar — Company Assignment Submission

