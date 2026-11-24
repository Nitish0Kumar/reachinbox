import { emailQueue } from "./emailQueue";
import { pool } from "../config/db";

interface Campaign {
  id: string;
  subject: string;
  body: string;
  sender_id?: string;
  sender_email?: string;
  scheduled_at?: Date | string;
  delay_seconds?: number;
  hourly_limit?: number;
}

export async function scheduleEmails(campaign: Campaign, recipients: string[]): Promise<void> {
  // Resolve sender email
  let senderEmail = campaign.sender_email || process.env.SMTP_USER || "noreply@reachinbox.ai";
  let hourlyLimit = campaign.hourly_limit ?? 100;

  if (campaign.sender_id) {
    try {
      const sr = await pool.query("SELECT email, hourly_limit FROM senders WHERE id = $1", [campaign.sender_id]);
      if (sr.rows.length) {
        senderEmail = sr.rows[0].email;
        hourlyLimit = sr.rows[0].hourly_limit ?? hourlyLimit;
      }
    } catch { /* non-fatal */ }
  }

  const scheduledAt = campaign.scheduled_at ? new Date(campaign.scheduled_at) : new Date();
  const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
  const betweenMs = (campaign.delay_seconds ?? 5) * 1000;

  // Fetch recipient IDs from DB
  let recipientRows: { id: string; email: string }[] = [];
  try {
    const dbResult = await pool.query(
      "SELECT id, email FROM recipients WHERE campaign_id = $1 AND status = 'scheduled' ORDER BY created_at ASC",
      [campaign.id]
    );
    recipientRows = dbResult.rows;
  } catch {
    // No DB – create placeholder rows using index
    recipientRows = recipients.map((email, i) => ({ id: `${campaign.id}-${i}`, email }));
  }

  for (let i = 0; i < recipientRows.length; i++) {
    const row = recipientRows[i];
    const jobDelay = delayMs + i * betweenMs;

    await emailQueue.add(
      "send-email",
      {
        recipientId: row.id,
        campaignId: campaign.id,
        to: row.email,
        subject: campaign.subject,
        body: campaign.body,
        senderEmail,
        hourlyLimit,
      },
      { delay: jobDelay, jobId: `camp-${campaign.id}-rec-${row.id}` }
    );
  }

  console.log(`🗓  Scheduled ${recipientRows.length} email jobs for campaign ${campaign.id}`);
}

