
import dotenv from "dotenv";
dotenv.config();

import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import nodemailer, { type Transporter } from "nodemailer";
import { pool } from "../config/db";

// ── Redis Connection (Railway) ─────────────────────────────────

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL is missing!");
}

export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    return Math.min(times * 1000, 5000);
  },
});

redisConnection.on("connect", () => {
  console.log("Redis connecting...");
});

redisConnection.on("ready", () => {
  console.log("Redis connected successfully!");
});

redisConnection.on("error", (err) => {
  console.error("Redis connection error:", err.message);
});

redisConnection.on("reconnecting", () => {
  console.log("Redis reconnecting...");
});

// ── Email Transporter ─────────────────────────────────────────

let transporter: Transporter | null = null;

export async function getMailTransporter(): Promise<Transporter> {
  if (transporter) return transporter;

  if (
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  ) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    console.log("SMTP transporter initialized");
  } else {
    const account = await nodemailer.createTestAccount();

    console.log("Ethereal test account initialized:", account.user);

    transporter = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: {
        user: account.user,
        pass: account.pass,
      },
    });
  }

  return transporter;
}

// ── Queue ──────────────────────────────────────────────────────

export const emailQueue = new Queue("email-queue", {
  connection: redisConnection,

  defaultJobOptions: {
    attempts: 3,

    backoff: {
      type: "exponential",
      delay: 5000,
    },

    removeOnComplete: {
      count: 200,
    },

    removeOnFail: {
      count: 200,
    },
  },
});

// ── Hourly Rate Limiter ────────────────────────────────────────

export async function checkHourlyLimit(
  senderEmail: string,
  limit: number
): Promise<boolean> {
  const currentHour = new Date().toISOString().slice(0, 13);

  const key = `rl:${senderEmail}:${currentHour}`;

  const count = await redisConnection.incr(key);

  if (count === 1) {
    await redisConnection.expire(key, 3600);
  }

  return count <= limit;
}

// ── Job Interface ──────────────────────────────────────────────

interface EmailJobData {
  recipientId: string;
  campaignId: string;
  to: string;
  subject: string;
  body: string;
  senderEmail: string;
  hourlyLimit: number;
}

// ── Email Worker ───────────────────────────────────────────────

export const emailWorker = new Worker<EmailJobData>(
  "email-queue",

  async (job: Job<EmailJobData>) => {
    const {
      recipientId,
      campaignId,
      to,
      subject,
      body,
      senderEmail,
      hourlyLimit,
    } = job.data;

    console.log(`Processing email job ${job.id} → ${to}`);

    // 1. Check hourly limit
    const allowed = await checkHourlyLimit(
      senderEmail,
      hourlyLimit
    );

    if (!allowed) {
      const msToNextHour =
        3600_000 - (Date.now() % 3600_000);

      console.log(
        `Rate limit reached for ${senderEmail}. Deferring email.`
      );

      // Slack notification
      if (process.env.SLACK_WEBHOOK_URL) {
        await fetch(process.env.SLACK_WEBHOOK_URL, {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            text: `ReachInbox: Hourly limit (${hourlyLimit}) reached for ${senderEmail}. Next batch in approximately ${Math.ceil(msToNextHour / 60000)} minutes.`,
          }),
        }).catch((err) => {
          console.warn("Slack notification failed:", err);
        });
      }

      // Schedule another job
      await emailQueue.add(
        "send-email",
        job.data,
        {
          delay: msToNextHour,
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        }
      );

      return {
        deferred: true,
      };
    }

    // 2. Initialize transporter
    const mailTransporter = await getMailTransporter();

    // 3. Send email
    const info = await mailTransporter.sendMail({
      from: `"ReachInbox" <${senderEmail}>`,
      to,
      subject,
      html: body,
      text: body.replace(/<[^>]*>/g, ""),
    });

    const previewUrl =
      nodemailer.getTestMessageUrl(info) || "";

    console.log(`Email sent successfully to ${to}`);

    if (previewUrl) {
      console.log("Email Preview:", previewUrl);
    }

    // 4. Update recipient status
    await pool.query(
      `UPDATE recipients
       SET status = 'sent',
           sent_at = NOW(),
           error_message = NULL
       WHERE id = $1`,
      [recipientId]
    );

    // 5. Check campaign completion
    const pending = await pool.query(
      `SELECT COUNT(*)
       FROM recipients
       WHERE campaign_id = $1
       AND status NOT IN ('sent', 'failed')`,
      [campaignId]
    );

    if (Number(pending.rows[0].count) === 0) {
      await pool.query(
        `UPDATE campaigns
         SET status = 'sent'
         WHERE id = $1`,
        [campaignId]
      );

      console.log(`Campaign ${campaignId} completed`);
    }

    return {
      success: true,
      previewUrl,
    };
  },

  {
    connection: redisConnection,
    concurrency: 5,
  }
);

// ── Completed Event ────────────────────────────────────────────

emailWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

// ── Failed Event ───────────────────────────────────────────────

emailWorker.on("failed", async (job, err) => {
  console.error(
    `Job ${job?.id} failed:`,
    err.message
  );

  if (!job?.data?.recipientId) return;

  try {
    await pool.query(
      `UPDATE recipients
       SET status = 'failed',
           error_message = $1
       WHERE id = $2`,
      [err.message, job.data.recipientId]
    );

    const pending = await pool.query(
      `SELECT COUNT(*)
       FROM recipients
       WHERE campaign_id = $1
       AND status NOT IN ('sent', 'failed')`,
      [job.data.campaignId]
    );

    if (Number(pending.rows[0].count) === 0) {
      await pool.query(
        `UPDATE campaigns
         SET status = 'failed'
         WHERE id = $1
         AND status != 'sent'`,
        [job.data.campaignId]
      );
    }
  } catch (dbErr) {
    console.error(
      "Database update failed:",
      dbErr
    );
  }
});

// ── Worker Error Event ─────────────────────────────────────────

emailWorker.on("error", (err) => {
  console.error("Worker error:", err.message);
});

console.log("Email queue and worker initialized");
