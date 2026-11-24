const BASE = "http://localhost:5001";

type ApiResponse<T> = { success: boolean; message?: string } & T;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
  });
  const data = (await res.json()) as ApiResponse<T>;
  if (!data.success) throw new Error(data.message || "API error");
  return data as T;
}

export const api = {
  // Auth
  getMe: () => request<{
    authenticated: boolean;
    googleOAuthConfigured: boolean;
    user: { id: string; name: string; email: string; avatar_url?: string } | null;
  }>("/auth/me"),
  logout: () => request<Record<string, never>>("/auth/logout", { method: "POST" }),
  // Stats
  getStats: () => request<{
    campaigns: { total: number; scheduled: number; sent: number; failed: number; draft: number };
    recipients: { total: number; scheduled: number; sent: number; failed: number };
    queue: { waiting: number; active: number; completed: number; failed: number };
  }>("/api/stats"),

  // Campaigns
  getCampaigns: (params?: { status?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.search) qs.set("search", params.search);
    const q = qs.toString();
    return request<{ campaigns: Campaign[]; count: number }>(`/api/campaigns${q ? "?" + q : ""}`);
  },
  getCampaign: (id: string) => request<{ campaign: Campaign }>(`/api/campaigns/${id}`),
  createCampaign: (payload: CreateCampaignPayload) =>
    request<{ campaign: Campaign }>("/api/campaigns", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteCampaign: (id: string) =>
    request<Record<string, never>>(`/api/campaigns/${id}`, { method: "DELETE" }),
  retryFailed: (id: string) =>
    request<{ retried: number }>(`/api/campaigns/${id}/retry-failed`, { method: "POST" }),

  // Recipients
  getRecipients: (params?: { campaign_id?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.campaign_id) qs.set("campaign_id", params.campaign_id);
    if (params?.status) qs.set("status", params.status);
    const q = qs.toString();
    return request<{ recipients: Recipient[] }>(`/api/recipients${q ? "?" + q : ""}`);
  },

  // Senders
  getSenders: () => request<{ senders: Sender[] }>("/api/senders"),
  createSender: (payload: { email: string; display_name?: string; hourly_limit?: number }) =>
    request<{ sender: Sender }>("/api/senders", { method: "POST", body: JSON.stringify(payload) }),
  deleteSender: (id: string) =>
    request<Record<string, never>>(`/api/senders/${id}`, { method: "DELETE" }),

  // Test email
  sendTestEmail: (payload: { to: string; subject: string; html: string }) =>
    request<{ previewUrl: string | false; messageId: string }>("/api/test-email", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  body: string;
  sender_id?: string;
  sender_email?: string;
  sender_name?: string;
  scheduled_at?: string;
  delay_seconds: number;
  hourly_limit: number;
  status: "scheduled" | "sent" | "failed" | "draft";
  created_at: string;
  recipient_count?: number;
  sent_count?: number;
  failed_count?: number;
}

export interface Recipient {
  id: string;
  campaign_id: string;
  campaign_name?: string;
  email: string;
  status: "scheduled" | "sent" | "failed";
  scheduled_at?: string;
  sent_at?: string;
  error_message?: string;
  created_at: string;
}

export interface Sender {
  id: string;
  email: string;
  display_name?: string;
  hourly_limit: number;
  created_at: string;
}

export interface CreateCampaignPayload {
  name: string;
  subject: string;
  body: string;
  sender_email?: string;
  sender_id?: string;
  recipients: string[];
  scheduled_at?: string;
  delay_seconds?: number;
  hourly_limit?: number;
}

