import dotenv from "dotenv";
dotenv.config();

import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import nodemailer, { type Transporter } from "nodemailer";
import { pool } from "../config/db";

export const redisConnection = new IORedis(
  process.env.REDIS_URL || "redis://127.0.0.1:6379",
  { maxRetriesPerRequest: null }
);

// ── Transporter ──────────────────────────────────────────────────────────────
let _transporter: Transporter | null = null;
export async function getMailTransporter(): Promise<Transporter> {
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
    console.log("⚡ Ethereal:", acct.user, "/", acct.pass);
    _transporter = nodemailer.createTransport({
      host: acct.smtp.host,
      port: acct.smtp.port,
      secure: acct.smtp.secure,
      auth: { user: acct.user, pass: acct.pass },
    });
  }
  return _transporter;
}

// ── Queue ────────────────────────────────────────────────────────────────────
export const emailQueue = new Queue("email-queue", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 200 },
  },
});

// ── Hourly rate-limit helper (Redis INCR + TTL) ──────────────────────────────
export async function checkHourlyLimit(senderEmail: string, limit: number): Promise<boolean> {
  const key = `rl:${senderEmail}:${new Date().toISOString().slice(0, 13)}`; // e.g. rl:a@b.com:2026-11-24T10
  const count = await redisConnection.incr(key);
  if (count === 1) await redisConnection.expire(key, 3600);
  return count <= limit;
}

// ── Worker ───────────────────────────────────────────────────────────────────
interface EmailJobData {
  recipientId: string;
  campaignId: string;
  to: string;
  subject: string;
  body: string;
  senderEmail: string;
  hourlyLimit: number;
}

export const emailWorker = new Worker<EmailJobData>(
  "email-queue",
  async (job: Job<EmailJobData>) => {
    const { recipientId, to, subject, body, senderEmail, hourlyLimit } = job.data;
    console.log(`📧 Processing job ${job.id} → ${to}`);

    // Check hourly limit
    const allowed = await checkHourlyLimit(senderEmail, hourlyLimit);
    if (!allowed) {
      // Defer to next hour boundary
      const msToNextHour = 3600_000 - (Date.now() % 3600_000);
      console.log(`⏳ Rate limit hit for ${senderEmail}, deferring ${msToNextHour}ms`);

      // Notify Slack if configured
      if (process.env.SLACK_WEBHOOK_URL) {
        await fetch(process.env.SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `⚠️ ReachInbox: Hourly limit (${hourlyLimit}) reached for *${senderEmail}*. Next batch in ~${Math.ceil(msToNextHour / 60000)} min.`,
          }),
        }).catch(console.warn);
      }

      await emailQueue.add(
        "send-email",
        job.data,
        { delay: msToNextHour, attempts: 3, backoff: { type: "exponential", delay: 5000 } }
      );
      return { deferred: true };
    }

    const transporter = await getMailTransporter();
    const info = await transporter.sendMail({
      from: `"ReachInbox" <${senderEmail}>`,
      to,
      subject,
      html: body,
      text: body.replace(/<[^>]*>/g, ""),
    });

    const previewUrl = nodemailer.getTestMessageUrl(info) || "";
    console.log(`✅ Sent to ${to} | Preview: ${previewUrl}`);

    // Update recipient status in DB
    try {
      await pool.query(
        "UPDATE recipients SET status = 'sent', sent_at = NOW() WHERE id = $1",
        [recipientId]
      );
      // Check if all recipients sent — update campaign
      const pending = await pool.query(
        "SELECT COUNT(*) FROM recipients WHERE campaign_id = $1 AND status NOT IN ('sent','failed')",
        [job.data.campaignId]
      );
      if (Number(pending.rows[0].count) === 0) {
        await pool.query(
          "UPDATE campaigns SET status = 'sent' WHERE id = $1",
          [job.data.campaignId]
        );
      }
    } catch (dbErr) {
      console.warn("DB update failed (non-fatal):", dbErr);
    }

    return { success: true, previewUrl };
  },
  { connection: redisConnection, concurrency: 5 }
);

emailWorker.on("completed", (job) => console.log(`✅ Job ${job.id} completed`));
emailWorker.on("failed", async (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
  if (job?.data?.recipientId) {
    try {
      await pool.query(
        "UPDATE recipients SET status = 'failed', error_message = $1 WHERE id = $2",
        [err.message, job.data.recipientId]
      );
      // Mark campaign failed if all failed
      const pending = await pool.query(
        "SELECT COUNT(*) FROM recipients WHERE campaign_id = $1 AND status NOT IN ('sent','failed')",
        [job.data.campaignId]
      );
      if (Number(pending.rows[0].count) === 0) {
        await pool.query(
          "UPDATE campaigns SET status = 'failed' WHERE id = $1 AND status != 'sent'",
          [job.data.campaignId]
        );
      }
    } catch (dbErr) {
      console.warn("DB error on failure:", dbErr);
    }
  }
});

console.log("📬 Email queue and worker initialized");
