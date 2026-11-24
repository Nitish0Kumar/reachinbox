import { useEffect, useMemo, useState, useCallback, type FormEvent } from "react";
import Papa from "papaparse";
import {
  LayoutDashboard, CalendarClock, Send, CircleX, Settings, Search, Bell,
  Plus, Mail, Users, CheckCircle2, Clock3, Menu, X, Upload, Trash2,
  RefreshCw, TrendingUp, Activity, Server, ChevronRight, AlertCircle,
  Inbox, Eye, ExternalLink, Zap,
} from "lucide-react";
import { api, type Campaign, type Sender, type Recipient } from "./api";

// ── Types ────────────────────────────────────────────────────────────────────
interface Stats {
  campaigns: { total: number; scheduled: number; sent: number; failed: number; draft: number };
  recipients: { total: number; scheduled: number; sent: number; failed: number };
  queue: { waiting: number; active: number; completed: number; failed: number };
}

type Page = "Dashboard" | "Scheduled" | "Sent" | "Failed" | "Senders" | "Settings";

// ── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl px-5 py-3.5 shadow-2xl text-white text-sm font-medium animate-slide-up ${type === "success" ? "bg-emerald-600" : "bg-red-600"}`}>
      {type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      {msg}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100"><X size={14} /></button>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ title, value, sub, icon: Icon, color }: { title: string; value: number | string; sub: string; icon: React.ElementType; color: string }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">{title}</p>
          <p className="text-3xl font-bold text-slate-800">{typeof value === "number" ? value.toLocaleString() : value}</p>
          <p className="text-xs text-slate-500 mt-1">{sub}</p>
        </div>
        <div className={`rounded-xl p-3 ${color}`}>
          <Icon size={22} className="text-white" />
        </div>
      </div>
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────
function Badge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    scheduled: "bg-blue-50 text-blue-700 border-blue-100",
    sent: "bg-emerald-50 text-emerald-700 border-emerald-100",
    failed: "bg-red-50 text-red-700 border-red-100",
    draft: "bg-slate-100 text-slate-600 border-slate-200",
  };
  const icons: Record<string, React.ElementType> = { scheduled: Clock3, sent: CheckCircle2, failed: CircleX, draft: Inbox };
  const Icon = icons[status] ?? Clock3;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[status] ?? "bg-slate-50 text-slate-500 border-slate-100"}`}>
      <Icon size={11} /> {status}
    </span>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState<Page>("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [showSenderModal, setShowSenderModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Auth state
  const [authUser, setAuthUser] = useState<{ id: string; name: string; email: string; avatar_url?: string } | null>(null);
  const [googleOAuthConfigured, setGoogleOAuthConfigured] = useState(false);

  // Data state
  const [stats, setStats] = useState<Stats | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);

  // Form state
  const [form, setForm] = useState({
    name: "", subject: "", body: "", senderEmail: "", senderId: "",
    startTime: "", delay: "5", hourlyLimit: "100",
  });
  const [recipientList, setRecipientList] = useState<string[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Sender form
  const [senderForm, setSenderForm] = useState({ email: "", display_name: "", hourly_limit: "100" });

  const toast$ = (msg: string, type: "success" | "error" = "success") => setToast({ msg, type });

  // ── Check backend ──────────────────────────────────────────────────────────
  const checkBackend = useCallback(async () => {
    try {
      const r = await fetch("http://localhost:5001/health");
      setBackendOnline(r.ok);
    } catch { setBackendOnline(false); }
  }, []);

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    try { setStats(await api.getStats()); } catch { /* offline */ }
  }, []);

  const loadCampaigns = useCallback(async (statusFilter?: string) => {
    setLoading(true);
    try {
      const res = await api.getCampaigns({ status: statusFilter, search: searchTerm || undefined });
      setCampaigns(res.campaigns);
    } catch { /* offline – campaigns stay empty */ }
    finally { setLoading(false); }
  }, [searchTerm]);

  const loadSenders = useCallback(async () => {
    try { setSenders((await api.getSenders()).senders); } catch { /* offline */ }
  }, []);

  const loadRecipients = useCallback(async (statusFilter?: string) => {
    try { setRecipients((await api.getRecipients({ status: statusFilter })).recipients); } catch { /* offline */ }
  }, []);

  const loadAuth = useCallback(async () => {
    try {
      const me = await api.getMe();
      setAuthUser(me.user);
      setGoogleOAuthConfigured(me.googleOAuthConfigured);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    checkBackend();
    loadAuth();
    loadStats();
    loadSenders();
  }, [checkBackend, loadAuth, loadStats, loadSenders]);

  useEffect(() => {
    if (page === "Dashboard") { loadStats(); loadCampaigns(); }
    else if (page === "Scheduled") loadCampaigns("scheduled");
    else if (page === "Sent") { loadCampaigns("sent"); loadRecipients("sent"); }
    else if (page === "Failed") { loadCampaigns("failed"); loadRecipients("failed"); }
    else if (page === "Senders") loadSenders();
  }, [page, loadStats, loadCampaigns, loadSenders, loadRecipients]);

  // ── CSV Upload ──────────────────────────────────────────────────────────────
  const handleCSVUpload = (file: File) => {
    setUploadError(""); setRecipientList([]); setCsvFileName("");
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const emails = results.data.flat().map(v => v.trim()).filter(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
        const unique = [...new Set(emails)];
        if (!unique.length) { setUploadError("No valid email addresses found."); return; }
        setRecipientList(unique);
        setCsvFileName(file.name);
      },
      error: () => setUploadError("Failed to read file."),
    });
  };

  // ── Create Campaign ─────────────────────────────────────────────────────────
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!recipientList.length) { toast$("Upload a CSV/TXT file with email addresses.", "error"); return; }
    if (!form.startTime) { toast$("Please select a scheduled date/time.", "error"); return; }
    if (new Date(form.startTime).getTime() <= Date.now()) { toast$("Scheduled time must be in the future.", "error"); return; }

    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        subject: form.subject,
        body: form.body,
        sender_id: form.senderId || undefined,
        sender_email: form.senderEmail || undefined,
        recipients: recipientList,
        scheduled_at: new Date(form.startTime).toISOString(),
        delay_seconds: Number(form.delay),
        hourly_limit: Number(form.hourlyLimit),
      };
      await api.createCampaign(payload);
      toast$(`Campaign "${form.name}" created and scheduled!`);
      setShowCompose(false);
      setForm({ name: "", subject: "", body: "", senderEmail: "", senderId: "", startTime: "", delay: "5", hourlyLimit: "100" });
      setRecipientList([]); setCsvFileName("");
      setPage("Scheduled");
      loadCampaigns("scheduled");
      loadStats();
    } catch (err) {
      toast$((err as Error).message || "Failed to create campaign.", "error");
    } finally { setSubmitting(false); }
  };

  // ── Delete Campaign ──────────────────────────────────────────────────────────
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete campaign "${name}"?`)) return;
    try {
      await api.deleteCampaign(id);
      toast$("Campaign deleted.");
      setCampaigns(prev => prev.filter(c => c.id !== id));
      loadStats();
    } catch (err) { toast$((err as Error).message, "error"); }
  };

  // ── Retry Failed ─────────────────────────────────────────────────────────────
  const handleRetry = async (id: string) => {
    try {
      const res = await api.retryFailed(id);
      toast$(`Retried ${res.retried} failed emails.`);
      loadCampaigns("failed");
    } catch (err) { toast$((err as Error).message, "error"); }
  };

  // ── Create Sender ─────────────────────────────────────────────────────────
  const handleCreateSender = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      await api.createSender({
        email: senderForm.email,
        display_name: senderForm.display_name,
        hourly_limit: Number(senderForm.hourly_limit),
      });
      toast$("Sender added!");
      setShowSenderModal(false);
      setSenderForm({ email: "", display_name: "", hourly_limit: "100" });
      loadSenders();
    } catch (err) { toast$((err as Error).message, "error"); }
  };

  // ── Filtered campaigns ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return campaigns;
    const t = searchTerm.toLowerCase();
    return campaigns.filter(c =>
      c.name.toLowerCase().includes(t) ||
      c.subject.toLowerCase().includes(t) ||
      (c.sender_email || "").toLowerCase().includes(t)
    );
  }, [campaigns, searchTerm]);

  const fmt = (d?: string) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  // ── Nav ───────────────────────────────────────────────────────────────────
  const navItems: { name: Page; icon: React.ElementType; label: string }[] = [
    { name: "Dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { name: "Scheduled", icon: CalendarClock, label: "Scheduled" },
    { name: "Sent", icon: Send, label: "Sent" },
    { name: "Failed", icon: CircleX, label: "Failed" },
    { name: "Senders", icon: Users, label: "Senders" },
    { name: "Settings", icon: Settings, label: "Settings" },
  ];

  // ── Dashboard content ─────────────────────────────────────────────────────
  const DashboardPage = () => (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Total Campaigns" value={stats?.campaigns.total ?? 0} sub="All time" icon={Mail} color="bg-indigo-500" />
        <StatCard title="Emails Scheduled" value={stats?.recipients.scheduled ?? 0} sub="In queue" icon={Clock3} color="bg-blue-500" />
        <StatCard title="Emails Sent" value={stats?.recipients.sent ?? 0} sub="Successfully delivered" icon={CheckCircle2} color="bg-emerald-500" />
        <StatCard title="Failed Emails" value={stats?.recipients.failed ?? 0} sub="Need attention" icon={CircleX} color="bg-red-500" />
      </div>

      {/* Email Activity Chart + Sender Summary */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-2xl bg-white border border-slate-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-slate-800 flex items-center gap-2"><TrendingUp size={16} className="text-indigo-500" /> Email Delivery Activity</h3>
              <p className="text-xs text-slate-400 mt-0.5">Live breakdown from PostgreSQL &amp; BullMQ</p>
            </div>
            <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
              {(stats?.recipients.total ?? 0).toLocaleString()} total recipients
            </span>
          </div>
          {(() => {
            const total = Math.max(1, stats?.recipients.total ?? 0);
            const bars = [
              { label: "Sent", count: stats?.recipients.sent ?? 0, barClass: "bg-emerald-500", textClass: "text-emerald-700" },
              { label: "Scheduled", count: stats?.recipients.scheduled ?? 0, barClass: "bg-blue-500", textClass: "text-blue-700" },
              { label: "Failed", count: stats?.recipients.failed ?? 0, barClass: "bg-red-500", textClass: "text-red-700" },
            ];
            return (
              <div className="space-y-4 mt-2">
                {bars.map(b => {
                  const pct = Math.round((b.count / total) * 100);
                  return (
                    <div key={b.label}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-medium text-slate-600">{b.label}</span>
                        <span className={`font-semibold ${b.textClass}`}>{b.count.toLocaleString()} ({pct}%)</span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div className={`h-full rounded-full ${b.barClass} transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* Sender Accounts Summary */}
        <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Users size={16} className="text-indigo-500" /> Sender Accounts</h3>
            <button onClick={() => setPage("Senders")} className="text-xs text-indigo-600 hover:underline">Manage</button>
          </div>
          {senders.length === 0 ? (
            <div className="text-center py-6 text-slate-400 text-xs">
              <p>No senders configured</p>
              <button onClick={() => setShowSenderModal(true)} className="mt-2 text-indigo-600 hover:underline font-medium">+ Add Sender</button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {senders.slice(0, 4).map(s => (
                <div key={s.id} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{s.display_name || s.email}</p>
                    <p className="text-[11px] text-slate-400 truncate">{s.email}</p>
                  </div>
                  <span className="text-[11px] font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full ml-2 shrink-0">{s.hourly_limit}/hr</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Queue status + recent */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Queue */}
        <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Activity size={16} className="text-indigo-500" /> Queue Status</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${backendOnline ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
              {backendOnline ? "● Online" : "● Offline"}
            </span>
          </div>
          <div className="space-y-3">
            {[
              { label: "Waiting", value: stats?.queue.waiting ?? 0, color: "bg-blue-100 text-blue-700" },
              { label: "Active", value: stats?.queue.active ?? 0, color: "bg-amber-100 text-amber-700" },
              { label: "Completed", value: stats?.queue.completed ?? 0, color: "bg-emerald-100 text-emerald-700" },
              { label: "Failed", value: stats?.queue.failed ?? 0, color: "bg-red-100 text-red-700" },
            ].map(q => (
              <div key={q.label} className="flex items-center justify-between">
                <span className="text-sm text-slate-600">{q.label}</span>
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${q.color}`}>{q.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <a href="http://localhost:5001/admin/queues" target="_blank" rel="noreferrer"
            className="mt-4 flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-medium">
            Open Bull Board <ExternalLink size={11} />
          </a>
        </div>

        {/* Recent campaigns */}
        <div className="xl:col-span-2 rounded-2xl bg-white border border-slate-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2"><TrendingUp size={16} className="text-indigo-500" /> Recent Campaigns</h3>
            <button onClick={() => setPage("Scheduled")} className="text-xs text-indigo-600 hover:underline flex items-center gap-1">View all <ChevronRight size={12} /></button>
          </div>
          {campaigns.length === 0
            ? <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <Inbox size={40} className="mb-3 opacity-30" />
                <p className="text-sm">No campaigns yet</p>
                <button onClick={() => setShowCompose(true)} className="mt-3 text-xs text-indigo-600 hover:underline font-medium">Create your first campaign →</button>
              </div>
            : <div className="space-y-3">
                {campaigns.slice(0, 5).map(c => (
                  <div key={c.id} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{c.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{c.sender_email || "—"} · {fmt(c.scheduled_at)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500">{(c.recipient_count ?? 0).toLocaleString()} recip.</span>
                      <Badge status={c.status} />
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>
    </div>
  );

  // ── Campaign Table ───────────────────────────────────────────────────────────
  const CampaignTable = ({ showRetry = false }: { showRetry?: boolean }) => (
    <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-x-auto">
      {loading
        ? <div className="flex items-center justify-center py-20 text-slate-400 gap-3"><RefreshCw size={18} className="animate-spin" /> Loading…</div>
        : filtered.length === 0
          ? <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <Inbox size={48} className="mb-3 opacity-20" />
              <p className="text-sm font-medium">No campaigns found</p>
            </div>
          : <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {["Campaign", "Sender", "Subject", "Recipients", "Scheduled", "Status", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3.5">
                      <p className="font-medium text-slate-800">{c.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">Created {fmt(c.created_at)}</p>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 text-xs">{c.sender_email || "—"}</td>
                    <td className="px-4 py-3.5 text-slate-600 max-w-[200px] truncate">{c.subject}</td>
                    <td className="px-4 py-3.5">
                      <div className="text-slate-700 font-medium">{(c.recipient_count ?? 0).toLocaleString()}</div>
                      {c.sent_count !== undefined && (
                        <div className="text-xs text-slate-400 mt-0.5">
                          {c.sent_count} sent · {c.failed_count ?? 0} failed
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 text-xs whitespace-nowrap">{fmt(c.scheduled_at)}</td>
                    <td className="px-4 py-3.5"><Badge status={c.status} /></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        {showRetry && c.status === "failed" && (
                          <button onClick={() => handleRetry(c.id)} title="Retry failed" className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors">
                            <RefreshCw size={14} />
                          </button>
                        )}
                        <button onClick={() => handleDelete(c.id, c.name)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
      }
    </div>
  );

  // ── Compose Modal ────────────────────────────────────────────────────────────
  const ComposeModal = () => (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2"><Zap size={18} className="text-indigo-500" /> New Campaign</h2>
          <button onClick={() => setShowCompose(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Campaign name */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Campaign Name *</label>
            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="e.g. Black Friday 2026" />
          </div>
          {/* Sender */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Sender Account</label>
            {senders.length > 0
              ? <select value={form.senderId} onChange={e => setForm(f => ({ ...f, senderId: e.target.value, senderEmail: "" }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                  <option value="">— Enter manually below —</option>
                  {senders.map(s => <option key={s.id} value={s.id}>{s.display_name || s.email} ({s.hourly_limit}/hr)</option>)}
                </select>
              : null}
            {!form.senderId && (
              <input value={form.senderEmail} onChange={e => setForm(f => ({ ...f, senderEmail: e.target.value }))}
                type="email" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 mt-2"
                placeholder="sender@example.com" />
            )}
          </div>
          {/* Subject */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Email Subject *</label>
            <input required value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="Your email subject" />
          </div>
          {/* Body */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Email Body (HTML supported) *</label>
            <textarea required rows={5} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none font-mono"
              placeholder="<p>Hello {{name}},</p><p>Your message here…</p>" />
          </div>
          {/* CSV Upload */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Recipients (CSV / TXT) *</label>
            <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl py-6 cursor-pointer transition-colors ${recipientList.length ? "border-emerald-300 bg-emerald-50" : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50"}`}>
              <Upload size={22} className={recipientList.length ? "text-emerald-500" : "text-slate-400"} />
              <span className="mt-2 text-sm font-medium text-slate-600">
                {csvFileName || "Click to upload CSV or TXT file"}
              </span>
              {recipientList.length > 0 && (
                <span className="mt-1 text-xs text-emerald-600 font-semibold">{recipientList.length} valid email{recipientList.length !== 1 ? "s" : ""} loaded</span>
              )}
              <input type="file" accept=".csv,.txt" className="hidden" onChange={e => { if (e.target.files?.[0]) handleCSVUpload(e.target.files[0]); }} />
            </label>
            {uploadError && <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12} /> {uploadError}</p>}
            {recipientList.length > 0 && (
              <div className="mt-2 max-h-24 overflow-y-auto rounded-lg border border-emerald-100 bg-emerald-50 p-2">
                {recipientList.slice(0, 20).map(e => <div key={e} className="text-xs text-emerald-800 py-0.5">{e}</div>)}
                {recipientList.length > 20 && <div className="text-xs text-emerald-600 font-medium mt-1">+{recipientList.length - 20} more…</div>}
              </div>
            )}
          </div>
          {/* Schedule / delay / limit */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Scheduled Date & Time *</label>
              <input required type="datetime-local" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Delay Between Emails (sec)</label>
              <input type="number" min={1} max={3600} value={form.delay} onChange={e => setForm(f => ({ ...f, delay: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Hourly Limit</label>
              <input type="number" min={1} max={10000} value={form.hourlyLimit} onChange={e => setForm(f => ({ ...f, hourlyLimit: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
          </div>
          {/* Footer */}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowCompose(false)} className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
            <button type="submit" disabled={submitting}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors">
              {submitting ? <><RefreshCw size={15} className="animate-spin" /> Creating…</> : <><Send size={15} /> Create Campaign</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  // ── Sender Modal ─────────────────────────────────────────────────────────────
  const SenderModal = () => (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <h2 className="font-bold text-slate-800">Add Sender Account</h2>
          <button onClick={() => setShowSenderModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>
        <form onSubmit={handleCreateSender} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Email Address *</label>
            <input required type="email" value={senderForm.email} onChange={e => setSenderForm(f => ({ ...f, email: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="sender@yourdomain.com" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Display Name</label>
            <input value={senderForm.display_name} onChange={e => setSenderForm(f => ({ ...f, display_name: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="Your Company Name" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Hourly Sending Limit</label>
            <input type="number" min={1} max={10000} value={senderForm.hourly_limit} onChange={e => setSenderForm(f => ({ ...f, hourly_limit: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowSenderModal(false)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">Add Sender</button>
          </div>
        </form>
      </div>
    </div>
  );

  // ── Senders Page ─────────────────────────────────────────────────────────────
  const SendersPage = () => (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-x-auto">
        {senders.length === 0
          ? <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Users size={40} className="mb-3 opacity-20" />
              <p className="text-sm font-medium">No sender accounts yet</p>
              <button onClick={() => setShowSenderModal(true)} className="mt-3 text-xs text-indigo-600 hover:underline font-medium">Add your first sender →</button>
            </div>
          : <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {["Email", "Display Name", "Hourly Limit", "Added", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {senders.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3.5 font-medium text-slate-800">{s.email}</td>
                    <td className="px-4 py-3.5 text-slate-600">{s.display_name || "—"}</td>
                    <td className="px-4 py-3.5">
                      <span className="bg-indigo-50 text-indigo-700 text-xs font-semibold px-2.5 py-0.5 rounded-full">{s.hourly_limit}/hr</span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-500 text-xs">{fmt(s.created_at)}</td>
                    <td className="px-4 py-3.5">
                      <button onClick={async () => {
                        if (!confirm(`Delete sender "${s.email}"?`)) return;
                        try { await api.deleteSender(s.id); toast$("Sender deleted."); loadSenders(); }
                        catch (err) { toast$((err as Error).message, "error"); }
                      }} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>
    </div>
  );

  // ── Settings Page ─────────────────────────────────────────────────────────────
  const SettingsPage = () => (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-6">
        <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2"><Server size={16} className="text-indigo-500" /> Backend Status</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center py-2 border-b border-slate-50">
            <span className="text-slate-600">API Server</span>
            <span className={`font-semibold ${backendOnline ? "text-emerald-600" : "text-red-600"}`}>{backendOnline ? "● Connected" : "● Offline"}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-slate-50">
            <span className="text-slate-600">API Base URL</span>
            <span className="text-slate-800 font-mono text-xs">http://localhost:5001</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-slate-50">
            <span className="text-slate-600">Bull Board</span>
            <a href="http://localhost:5001/admin/queues" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline text-xs flex items-center gap-1">Open <ExternalLink size={11} /></a>
          </div>
        </div>
        <button onClick={() => { checkBackend(); loadStats(); toast$("Status refreshed!"); }}
          className="mt-4 flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium">
          <RefreshCw size={14} /> Refresh Status
        </button>
      </div>
      <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-6">
        <h3 className="font-semibold text-slate-800 mb-1 flex items-center gap-2"><Eye size={16} className="text-indigo-500" /> Test Email Sending</h3>
        <p className="text-xs text-slate-500 mb-4">Send a test email via Ethereal SMTP to verify your configuration.</p>
        <TestEmailForm />
      </div>
    </div>
  );

  function TestEmailForm() {
    const [t, setT] = useState({ to: "", subject: "ReachInbox Test", html: "<p>Hello from <strong>ReachInbox</strong>!</p>" });
    const [result, setResult] = useState<string>("");
    const [sending, setSending] = useState(false);
    const submit = async (e: FormEvent) => {
      e.preventDefault(); setSending(true); setResult("");
      try {
        const r = await api.sendTestEmail(t);
        setResult(typeof r.previewUrl === "string" ? r.previewUrl : "Email sent (no preview URL)");
      } catch (err) { setResult("Error: " + (err as Error).message); }
      finally { setSending(false); }
    };
    return (
      <form onSubmit={submit} className="space-y-3">
        <input required type="email" placeholder="To email" value={t.to} onChange={e => setT(f => ({ ...f, to: e.target.value }))}
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        <input required placeholder="Subject" value={t.subject} onChange={e => setT(f => ({ ...f, subject: e.target.value }))}
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        <textarea rows={3} value={t.html} onChange={e => setT(f => ({ ...f, html: e.target.value }))}
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none font-mono" />
        <button type="submit" disabled={sending} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2">
          {sending ? <><RefreshCw size={14} className="animate-spin" /> Sending…</> : <><Send size={14} /> Send Test Email</>}
        </button>
        {result && (
          <div className="text-xs mt-2 p-3 bg-slate-50 rounded-lg border border-slate-100 break-all">
            {result.startsWith("http")
              ? <a href={result} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline flex items-center gap-1"><ExternalLink size={11} /> {result}</a>
              : <span className="text-red-600">{result}</span>}
          </div>
        )}
      </form>
    );
  }

  // ── Page titles ───────────────────────────────────────────────────────────────
  const pageMeta: Record<Page, { title: string; desc: string }> = {
    Dashboard: { title: "Dashboard", desc: "Welcome back! Here's your campaign overview." },
    Scheduled: { title: "Scheduled Campaigns", desc: "Upcoming email campaigns queued for delivery." },
    Sent: { title: "Sent Campaigns", desc: "Successfully delivered campaigns." },
    Failed: { title: "Failed Campaigns", desc: "Campaigns that need your attention." },
    Senders: { title: "Sender Accounts", desc: "Manage your sending email addresses." },
    Settings: { title: "Settings", desc: "Configure your ReachInbox workspace." },
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Sidebar */}
      <aside className={`fixed left-0 top-0 z-20 h-screen w-64 bg-white border-r border-slate-100 flex flex-col transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Logo */}
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md">
              <Mail size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-800">ReachInbox</h1>
              <p className="text-xs text-slate-400">.ai</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Workspace</p>
          {navItems.map(({ name, icon: Icon, label }) => {
            const active = page === name;
            return (
              <button key={name} onClick={() => { setPage(name); setSearchTerm(""); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${active ? "bg-indigo-50 text-indigo-700 shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-800"}`}>
                <Icon size={17} className={active ? "text-indigo-500" : "text-slate-400"} />
                {label}
                {name === "Failed" && (stats?.campaigns.failed ?? 0) > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">{stats!.campaigns.failed}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User profile / Google OAuth */}
        <div className="p-4 border-t border-slate-100">
          {authUser ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-3 px-2">
                {authUser.avatar_url ? (
                  <img src={authUser.avatar_url} alt={authUser.name} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                    {authUser.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-700 truncate">{authUser.name}</p>
                  <p className="text-xs text-slate-400 truncate">{authUser.email}</p>
                </div>
              </div>
              <button
                onClick={async () => {
                  await api.logout();
                  setAuthUser(null);
                  toast$("Logged out.");
                }}
                className="w-full text-xs font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 py-1.5 rounded-lg transition-colors"
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <button
                onClick={() => {
                  if (!googleOAuthConfigured) {
                    toast$("Set GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET in backend/.env to enable Google login.", "error");
                    return;
                  }
                  window.location.href = "http://localhost:5001/auth/google";
                }}
                className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold py-2 px-3 rounded-xl transition-colors"
              >
                Sign in with Google
              </button>
              <p className="text-[10px] text-center text-slate-400">
                {googleOAuthConfigured ? "Google OAuth ready" : "OAuth keys not configured in .env"}
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className={`min-h-screen transition-all duration-200 ${sidebarOpen ? "ml-64" : "ml-0"}`}>
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(o => !o)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
              <Menu size={18} />
            </button>
            <div>
              <h2 className="font-bold text-slate-800">{pageMeta[page].title}</h2>
              <p className="text-xs text-slate-400 hidden sm:block">{pageMeta[page].desc}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Search */}
            {page !== "Settings" && page !== "Senders" && (
              <div className="relative hidden sm:block">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search campaigns…"
                  className="pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 w-56" />
              </div>
            )}
            {/* Refresh */}
            <button onClick={() => {
              loadStats();
              if (page === "Senders") { loadSenders(); }
              else { loadCampaigns(page === "Dashboard" ? undefined : page.toLowerCase()); }
              if (page === "Sent" || page === "Failed") { loadRecipients(page.toLowerCase()); }
            }}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500" title="Refresh">
              <RefreshCw size={16} />
            </button>
            <button className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"><Bell size={16} /></button>
            {/* New Campaign */}
            <button onClick={() => page === "Senders" ? setShowSenderModal(true) : setShowCompose(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm">
              <Plus size={16} />
              {page === "Senders" ? "Add Sender" : "New Campaign"}
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="p-6">
          {!backendOnline && (
            <div className="mb-5 flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 px-5 py-3.5 text-sm text-amber-800">
              <AlertCircle size={16} className="text-amber-500 flex-shrink-0" />
              <span>Backend is offline. <strong>Start the backend</strong> with <code className="bg-amber-100 px-1.5 py-0.5 rounded text-xs">cd reachinbox/backend && npm run dev</code> to enable full functionality.</span>
            </div>
          )}
          {page === "Dashboard" && <DashboardPage />}
          {page === "Scheduled" && <CampaignTable />}
          {page === "Sent" && (
            <div className="space-y-6">
              <CampaignTable />
              {recipients.length > 0 && (
                <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800 text-sm">Sent Email Logs ({recipients.length})</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Recipient</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Campaign</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Sent At</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {recipients.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-3 font-medium text-slate-800">{r.email}</td>
                          <td className="px-4 py-3 text-slate-600">{r.campaign_name || "—"}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{fmt(r.sent_at)}</td>
                          <td className="px-4 py-3"><Badge status={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {page === "Failed" && (
            <div className="space-y-6">
              <CampaignTable showRetry />
              {recipients.length > 0 && (
                <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800 text-sm">Failed Email Logs ({recipients.length})</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Recipient</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Campaign</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Error</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {recipients.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-3 font-medium text-slate-800">{r.email}</td>
                          <td className="px-4 py-3 text-slate-600">{r.campaign_name || "—"}</td>
                          <td className="px-4 py-3 text-red-600 text-xs max-w-[260px] truncate">{r.error_message || "Delivery failed"}</td>
                          <td className="px-4 py-3"><Badge status={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {page === "Senders" && <SendersPage />}
          {page === "Settings" && <SettingsPage />}
        </div>
      </main>

      {/* Modals */}
      {showCompose && <ComposeModal />}
      {showSenderModal && <SenderModal />}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Keyframe for toast */}
      <style>{`
        @keyframes slide-up { from { transform: translateY(1rem); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .animate-slide-up { animation: slide-up 0.2s ease-out; }
      `}</style>
    </div>
  );
}
