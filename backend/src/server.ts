import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import crypto from "crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

import { connectDB, pool } from "./config/db";
import { emailQueue, redisConnection } from "./queues/emailQueue";
import { scheduleEmails } from "./queues/scheduler";

const app = express();
const PORT = Number(process.env.PORT) || 5001;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));

// ── Bull Board ───────────────────────────────────────────────────────────────
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
// Basic auth for the board
app.use("/admin/queues", (req: Request, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_TOKEN || "reachinbox-admin"}`) {
    res.setHeader("WWW-Authenticate", "Bearer realm=\"Bull Board\"");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}, serverAdapter.getRouter());

// ── Health ───────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.json({ success: true, message: "ReachInbox API is running!" }));
app.get("/health", (_req, res) =>
  res.json({ success: true, status: "healthy", service: "ReachInbox Backend", timestamp: new Date().toISOString() })
);

// ── Google OAuth 2.0 (Signed HttpOnly Session Cookie) ────────────────────────
const SESSION_COOKIE = "reachinbox_session";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5174";
const SESSION_SECRET = process.env.SESSION_SECRET || "reachinbox-dev-session-secret";

function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function signSession(payload: Record<string, unknown>): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifySession(token: string | undefined): Record<string, unknown> | null {
  if (!token || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx > -1) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}

app.get("/auth/google", (_req, res) => {
  if (!isGoogleOAuthConfigured()) {
    res.status(501).json({
      success: false,
      message: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env.",
    });
    return;
  }
  const redirectUri = process.env.GOOGLE_CALLBACK_URL || `http://localhost:${PORT}/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code as string | undefined;
    if (!code || !isGoogleOAuthConfigured()) {
      res.redirect(`${FRONTEND_URL}?auth_error=oauth_failed`);
      return;
    }

    const redirectUri = process.env.GOOGLE_CALLBACK_URL || `http://localhost:${PORT}/auth/google/callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      res.redirect(`${FRONTEND_URL}?auth_error=token_exchange_failed`);
      return;
    }

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = (await profileRes.json()) as {
      id?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    if (!profile.email || !profile.id) {
      res.redirect(`${FRONTEND_URL}?auth_error=profile_missing`);
      return;
    }

    const userRes = await pool.query(
      `INSERT INTO users (google_id, name, email, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         google_id = EXCLUDED.google_id,
         name = EXCLUDED.name,
         avatar_url = EXCLUDED.avatar_url
       RETURNING id, name, email, avatar_url`,
      [profile.id, profile.name || profile.email, profile.email, profile.picture || null]
    );
    const user = userRes.rows[0];
    const token = signSession({ id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url });

    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`
    );
    res.redirect(FRONTEND_URL);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    res.redirect(`${FRONTEND_URL}?auth_error=callback_error`);
  }
});

app.get("/auth/me", (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies[SESSION_COOKIE]);
  if (!session) {
    res.json({
      success: true,
      authenticated: false,
      googleOAuthConfigured: isGoogleOAuthConfigured(),
      user: null,
    });
    return;
  }
  res.json({
    success: true,
    authenticated: true,
    googleOAuthConfigured: isGoogleOAuthConfigured(),
    user: session,
  });
});

app.post("/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  res.json({ success: true, message: "Logged out" });
});

// ── Nodemailer transporter ───────────────────────────────────────────────────
let _transporter: Transporter | null = null;
async function getTransporter(): Promise<Transporter> {
  if (_transporter) return _transporter;
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } else {
    const acct = await nodemailer.createTestAccount();
    console.log("⚡ Ethereal test account:", acct.user, "/", acct.pass);
    _transporter = nodemailer.createTransport({
      host: acct.smtp.host,
      port: acct.smtp.port,
      secure: acct.smtp.secure,
      auth: { user: acct.user, pass: acct.pass },
    });
  }
  return _transporter;
}

// ── POST /api/test-email ─────────────────────────────────────────────────────
app.post("/api/test-email", async (req, res) => {
  try {
    const { to, subject, html, text } = req.body;
    if (!to || !subject) {
      res.status(400).json({ success: false, message: "'to' and 'subject' are required" });
      return;
    }
    const t = await getTransporter();
    const info = await t.sendMail({
      from: `"ReachInbox" <${process.env.SMTP_USER || "test@ethereal.email"}>`,
      to, subject,
      html: html ?? undefined,
      text: text ?? "ReachInbox test email",
    });
    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.log("✉️  Preview URL:", previewUrl);
    res.json({ success: true, previewUrl, messageId: info.messageId });
  } catch (err) {
    console.error("test-email error:", err);
    res.status(500).json({ success: false, message: "Failed to send email" });
  }
});

// ── GET /api/stats ───────────────────────────────────────────────────────────
app.get("/api/stats", async (_req, res) => {
  try {
    const [campaigns, recipients, waiting, active, completed, failed] = await Promise.all([
      pool.query("SELECT status, COUNT(*) as count FROM campaigns GROUP BY status"),
      pool.query("SELECT status, COUNT(*) as count FROM recipients GROUP BY status"),
      emailQueue.getWaitingCount(),
      emailQueue.getActiveCount(),
      emailQueue.getCompletedCount(),
      emailQueue.getFailedCount(),
    ]);

    const campaignCounts = { total: 0, scheduled: 0, sent: 0, failed: 0, draft: 0 };
    for (const row of campaigns.rows) {
      const s = row.status as string;
      campaignCounts.total += Number(row.count);
      if (s === "scheduled") campaignCounts.scheduled += Number(row.count);
      else if (s === "sent") campaignCounts.sent += Number(row.count);
      else if (s === "failed") campaignCounts.failed += Number(row.count);
      else if (s === "draft") campaignCounts.draft += Number(row.count);
    }

    const recipientCounts = { total: 0, scheduled: 0, sent: 0, failed: 0 };
    for (const row of recipients.rows) {
      const s = row.status as string;
      recipientCounts.total += Number(row.count);
      if (s === "scheduled") recipientCounts.scheduled += Number(row.count);
      else if (s === "sent") recipientCounts.sent += Number(row.count);
      else if (s === "failed") recipientCounts.failed += Number(row.count);
    }

    res.json({
      success: true,
      campaigns: campaignCounts,
      recipients: recipientCounts,
      queue: { waiting, active, completed, failed },
    });
  } catch (err) {
    console.error("stats error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
});

// ── GET /api/senders ─────────────────────────────────────────────────────────
app.get("/api/senders", async (_req, res) => {
  try {
    const result = await pool.query("SELECT id, email, display_name, hourly_limit, created_at FROM senders ORDER BY created_at DESC");
    res.json({ success: true, senders: result.rows });
  } catch (err) {
    console.error("senders error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch senders" });
  }
});

// ── POST /api/senders ────────────────────────────────────────────────────────
app.post("/api/senders", async (req, res) => {
  try {
    const { email, display_name, hourly_limit } = req.body;
    if (!email) {
      res.status(400).json({ success: false, message: "email is required" });
      return;
    }
    const result = await pool.query(
      `INSERT INTO senders (email, display_name, hourly_limit)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, hourly_limit = EXCLUDED.hourly_limit
       RETURNING id, email, display_name, hourly_limit, created_at`,
      [email, display_name || email, hourly_limit || 100]
    );
    res.status(201).json({ success: true, sender: result.rows[0] });
  } catch (err) {
    console.error("create sender error:", err);
    res.status(500).json({ success: false, message: "Failed to create sender" });
  }
});

// ── DELETE /api/senders/:id ───────────────────────────────────────────────────
app.delete("/api/senders/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM senders WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("delete sender error:", err);
    res.status(500).json({ success: false, message: "Failed to delete sender" });
  }
});

// ── GET /api/campaigns ───────────────────────────────────────────────────────
app.get("/api/campaigns", async (req, res) => {
  try {
    const { status, search } = req.query;
    let q = `
      SELECT c.*,
             s.email AS sender_email,
             s.display_name AS sender_name,
             COUNT(r.id)::int AS recipient_count,
             COUNT(r.id) FILTER (WHERE r.status = 'sent')::int AS sent_count,
             COUNT(r.id) FILTER (WHERE r.status = 'failed')::int AS failed_count
      FROM campaigns c
      LEFT JOIN senders s ON c.sender_id = s.id
      LEFT JOIN recipients r ON r.campaign_id = c.id
    `;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (status) {
      params.push(status);
      conditions.push(`c.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(c.name ILIKE $${params.length} OR c.subject ILIKE $${params.length})`);
    }
    if (conditions.length) q += " WHERE " + conditions.join(" AND ");
    q += " GROUP BY c.id, s.email, s.display_name ORDER BY c.created_at DESC";

    const result = await pool.query(q, params);
    res.json({ success: true, count: result.rows.length, campaigns: result.rows });
  } catch (err) {
    console.error("list campaigns error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch campaigns" });
  }
});

// ── POST /api/campaigns ──────────────────────────────────────────────────────
app.post("/api/campaigns", async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, subject, body, sender_email, sender_id, recipients, scheduled_at, delay_seconds, hourly_limit } = req.body;
    if (!name || !subject || !body) {
      res.status(400).json({ success: false, message: "name, subject, body are required" });
      return;
    }
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({ success: false, message: "At least one recipient is required" });
      return;
    }

    // Validate emails
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const validRecipients = [...new Set((recipients as string[]).filter(e => emailRe.test(e.trim())))];
    if (validRecipients.length === 0) {
      res.status(400).json({ success: false, message: "No valid email addresses found" });
      return;
    }

    await client.query("BEGIN");

    // Resolve or create sender
    let resolvedSenderId = sender_id || null;
    if (!resolvedSenderId && sender_email) {
      const sr = await client.query(
        `INSERT INTO senders (email, display_name, hourly_limit)
         VALUES ($1, $1, $2)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [sender_email, hourly_limit || 100]
      );
      resolvedSenderId = sr.rows[0].id;
    }

    // Insert campaign
    const scheduledAt = scheduled_at ? new Date(scheduled_at) : new Date(Date.now() + 60_000);
    const campaignResult = await client.query(
      `INSERT INTO campaigns (name, subject, body, sender_id, scheduled_at, delay_seconds, hourly_limit, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled')
       RETURNING *`,
      [name, subject, body, resolvedSenderId, scheduledAt, delay_seconds || 5, hourly_limit || 100]
    );
    const campaign = campaignResult.rows[0];

    // Insert recipients
    for (const email of validRecipients) {
      await client.query(
        `INSERT INTO recipients (campaign_id, email, status, scheduled_at)
         VALUES ($1,$2,'scheduled',$3)`,
        [campaign.id, email.trim(), scheduledAt]
      );
    }

    await client.query("COMMIT");

    // Schedule BullMQ jobs
    await scheduleEmails(campaign, validRecipients);

    res.status(201).json({
      success: true,
      message: "Campaign created and scheduled!",
      campaign: { ...campaign, recipient_count: validRecipients.length },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("create campaign error:", err);
    res.status(500).json({ success: false, message: "Failed to create campaign" });
  } finally {
    client.release();
  }
});

// ── GET /api/campaigns/:id ───────────────────────────────────────────────────
app.get("/api/campaigns/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*,
              s.email AS sender_email,
              COUNT(r.id)::int AS recipient_count,
              COUNT(r.id) FILTER (WHERE r.status = 'sent')::int AS sent_count,
              COUNT(r.id) FILTER (WHERE r.status = 'failed')::int AS failed_count
       FROM campaigns c
       LEFT JOIN senders s ON c.sender_id = s.id
       LEFT JOIN recipients r ON r.campaign_id = c.id
       WHERE c.id = $1
       GROUP BY c.id, s.email`,
      [req.params.id]
    );
    if (!result.rows.length) {
      res.status(404).json({ success: false, message: "Campaign not found" });
      return;
    }
    res.json({ success: true, campaign: result.rows[0] });
  } catch (err) {
    console.error("get campaign error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch campaign" });
  }
});

// ── DELETE /api/campaigns/:id ─────────────────────────────────────────────────
app.delete("/api/campaigns/:id", async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM campaigns WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rows.length) {
      res.status(404).json({ success: false, message: "Campaign not found" });
      return;
    }
    res.json({ success: true, message: "Campaign deleted" });
  } catch (err) {
    console.error("delete campaign error:", err);
    res.status(500).json({ success: false, message: "Failed to delete campaign" });
  }
});

// ── GET /api/campaigns/:id/recipients ────────────────────────────────────────
app.get("/api/campaigns/:id/recipients", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM recipients WHERE campaign_id = $1 ORDER BY created_at ASC",
      [req.params.id]
    );
    res.json({ success: true, recipients: result.rows });
  } catch (err) {
    console.error("recipients error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch recipients" });
  }
});

// ── GET /api/recipients ───────────────────────────────────────────────────────
app.get("/api/recipients", async (req, res) => {
  try {
    const { status, campaign_id } = req.query;
    let q = "SELECT r.*, c.name AS campaign_name FROM recipients r LEFT JOIN campaigns c ON r.campaign_id = c.id";
    const params: unknown[] = [];
    const conds: string[] = [];
    if (status) { params.push(status); conds.push(`r.status = $${params.length}`); }
    if (campaign_id) { params.push(campaign_id); conds.push(`r.campaign_id = $${params.length}`); }
    if (conds.length) q += " WHERE " + conds.join(" AND ");
    q += " ORDER BY r.created_at DESC LIMIT 500";
    const result = await pool.query(q, params);
    res.json({ success: true, recipients: result.rows });
  } catch (err) {
    console.error("list recipients error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch recipients" });
  }
});

// ── POST /api/campaigns/:id/retry-failed ─────────────────────────────────────
app.post("/api/campaigns/:id/retry-failed", async (req, res) => {
  try {
    const failed = await pool.query(
      "SELECT email FROM recipients WHERE campaign_id = $1 AND status = 'failed'",
      [req.params.id]
    );
    const campaign = await pool.query("SELECT * FROM campaigns WHERE id = $1", [req.params.id]);
    if (!campaign.rows.length) {
      res.status(404).json({ success: false, message: "Campaign not found" });
      return;
    }
    const emails = failed.rows.map((r: { email: string }) => r.email);
    if (!emails.length) {
      res.json({ success: true, message: "No failed recipients to retry" });
      return;
    }
    await pool.query(
      "UPDATE recipients SET status = 'scheduled', error_message = NULL WHERE campaign_id = $1 AND status = 'failed'",
      [req.params.id]
    );
    await scheduleEmails(campaign.rows[0], emails);
    res.json({ success: true, retried: emails.length });
  } catch (err) {
    console.error("retry failed error:", err);
    res.status(500).json({ success: false, message: "Failed to retry" });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
async function startServer() {
  try {
    try { await connectDB(); } catch (e) { console.warn("⚠️  DB offline:", e); }
    try { await emailQueue.waitUntilReady(); console.log("✅ Redis/BullMQ ready"); } catch (e) { console.warn("⚠️  Redis offline:", e); }
    app.listen(PORT, () => console.log(`🚀 ReachInbox API → http://localhost:${PORT}`));
  } catch (err) {
    console.error("Server startup failed:", err);
    process.exit(1);
  }
}
void startServer();
