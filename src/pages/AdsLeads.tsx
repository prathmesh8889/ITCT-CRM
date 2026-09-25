import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Megaphone, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { adsLeadApi } from "../lib/api";
import { fmtDT } from "../lib/services";
import { useStore } from "../store";
import { Badge, Btn, EmptyState, Input, Pagination, Select } from "../components/ui";

type AdsStatus = {
  integrations: {
    meta: { configured: boolean; endpoint: string; provider: string };
    secure_webhook: { configured: boolean; endpoint: string; providers: string[]; auth_header: string };
  };
  counts: { total: number; created: number; linked: number; failed: number };
};

type AdLeadRow = {
  id: number;
  provider: string;
  external_id: string;
  platform: string;
  campaign_name: string;
  campaign_id: string;
  ad_name: string;
  ad_id: string;
  form_name: string;
  form_id: string;
  full_name: string;
  email: string;
  phone: string;
  business_name: string;
  city: string;
  state: string;
  service_interest: string;
  source_url: string;
  status: string;
  lead_id: number | null;
  lead_code: string | null;
  lead_status: string | null;
  assigned_user_name: string | null;
  error: string;
  received_at: string;
};

type Paged = { items: AdLeadRow[]; total: number; page: number; page_size: number };

const providerTone = (provider: string): "blue" | "violet" | "teal" | "amber" | "slate" => {
  const p = provider.toLowerCase();
  if (p === "meta" || p === "facebook" || p === "instagram") return "blue";
  if (p === "tiktok") return "violet";
  if (p === "website") return "teal";
  if (p === "google") return "amber";
  return "slate";
};

const statusTone = (status: string): "green" | "blue" | "amber" | "red" | "slate" => {
  if (status === "Lead Created") return "green";
  if (status === "Linked Existing") return "blue";
  if (status === "Fetch Failed") return "red";
  if (status === "Received") return "amber";
  return "slate";
};

export default function AdsLeads() {
  const { can, toast } = useStore();
  const nav = useNavigate();
  const [status, setStatus] = useState<AdsStatus | null>(null);
  const [rows, setRows] = useState<AdLeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<number | null>(null);
  const pageSize = 30;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, list] = await Promise.all([
        adsLeadApi.status(),
        adsLeadApi.list({
          page,
          page_size: pageSize,
          search: q || undefined,
          provider: provider || undefined,
          status: stateFilter || undefined,
        }),
      ]);
      setStatus(s.data as AdsStatus);
      const payload = list.data as Paged;
      setRows(payload.items || []);
      setTotal(payload.total || 0);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load ad leads", "err");
      setRows([]);
    } finally { setLoading(false); }
  }, [page, q, provider, stateFilter, toast]);

  useEffect(() => { void load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const providers = useMemo(() => ["meta", "facebook", "instagram", "tiktok", "website", "google", "other"], []);

  const retry = async (row: AdLeadRow) => {
    setRetrying(row.id);
    try {
      await adsLeadApi.retry(row.id);
      toast("Meta lead retried", "ok");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not retry Meta lead", "err");
    } finally { setRetrying(null); }
  };

  return (
    <div className="mx-auto max-w-[1450px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Megaphone size={21} className="text-brand-600" /><h1 className="hd text-[22px]">Ads Leads</h1></div>
          <p className="mt-1 text-[12.5px] text-ink-500">
            Facebook / Instagram, TikTok bridge and website campaign leads arrive here first and are created as unassigned CRM leads for manager allocation.
          </p>
        </div>
        <Btn variant="outline" size="sm" onClick={() => void load()} loading={loading}><RefreshCw size={13} /> Refresh</Btn>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Captured</div>
          <div className="num mt-1 text-[22px] font-bold">{status?.counts.total ?? 0}</div>
          <div className="mt-1 text-[11px] text-ink-400">All incoming ad events</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">New CRM Leads</div>
          <div className="num mt-1 text-[22px] font-bold text-emerald-600">{status?.counts.created ?? 0}</div>
          <div className="mt-1 text-[11px] text-ink-400">Created automatically, still unassigned</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Duplicates Linked</div>
          <div className="num mt-1 text-[22px] font-bold text-brand-600">{status?.counts.linked ?? 0}</div>
          <div className="mt-1 text-[11px] text-ink-400">Matched to an existing CRM lead</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Needs Attention</div>
          <div className="num mt-1 text-[22px] font-bold text-red-600">{status?.counts.failed ?? 0}</div>
          <div className="mt-1 text-[11px] text-ink-400">Provider fetch failures only</div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-brand-600" /><div className="font-semibold">Meta Lead Ads</div></div>
            <Badge tone={status?.integrations.meta.configured ? "green" : "amber"}>{status?.integrations.meta.configured ? "Configured" : "Setup required"}</Badge>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-500">
            Direct signed webhook for Facebook / Instagram Lead Ads. App secret, verify token and Page access token stay in Railway environment variables and are never exposed in CRM.
          </p>
          <div className="mt-2 rounded bg-ink-50 px-2.5 py-2 font-mono text-[10.5px] text-ink-500 dark:bg-ink-800">{status?.integrations.meta.endpoint || "/api/integrations/ads/meta"}</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-brand-600" /><div className="font-semibold">TikTok / Website / Other Ads</div></div>
            <Badge tone={status?.integrations.secure_webhook.configured ? "green" : "amber"}>{status?.integrations.secure_webhook.configured ? "Configured" : "Setup required"}</Badge>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-500">
            Secure server-to-server webhook. Requests require the private X-ITCT-Webhook-Secret header; the secret is not stored in browser code.
          </p>
          <div className="mt-2 rounded bg-ink-50 px-2.5 py-2 font-mono text-[10.5px] text-ink-500 dark:bg-ink-800">{status?.integrations.secure_webhook.endpoint || "/api/integrations/ads/ingest/:provider"}</div>
        </div>
      </div>

      <div className="card mb-4 p-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input className="pl-8" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search contact, business, campaign, phone…" />
          </div>
          <Select className="!w-auto" value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }}>
            <option value="">All providers</option>
            {providers.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </Select>
          <Select className="!w-auto" value={stateFilter} onChange={(e) => { setStateFilter(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {["Lead Created", "Linked Existing", "Received", "Fetch Failed"].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </div>
      </div>

      {loading && !rows.length ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-[58px]" />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={<Megaphone size={24} />} title="No ad leads yet" body="When a connected lead form is submitted, the event will appear here and the CRM will create or link the matching lead." />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px]">
              <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50">
                <tr>
                  <th className="th">Received</th><th className="th">Source</th><th className="th">Prospect</th>
                  <th className="th">Campaign / Ad</th><th className="th">Service</th><th className="th">CRM Lead</th>
                  <th className="th">Status</th><th className="th text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-ink-100 last:border-0 dark:border-ink-800">
                    <td className="td num text-[11px] text-ink-400">{fmtDT(r.received_at)}</td>
                    <td className="td"><Badge tone={providerTone(r.provider)}>{r.platform || r.provider}</Badge></td>
                    <td className="td">
                      <div className="font-semibold">{r.business_name || r.full_name || "Unknown prospect"}</div>
                      <div className="mt-0.5 text-[11px] text-ink-400">{r.full_name || "—"} · {r.phone || r.email || "No contact field"}</div>
                      {(r.city || r.state) && <div className="text-[10.5px] text-ink-400">{[r.city, r.state].filter(Boolean).join(", ")}</div>}
                    </td>
                    <td className="td">
                      <div className="max-w-[260px] truncate text-[12px] font-medium">{r.campaign_name || r.campaign_id || "—"}</div>
                      <div className="max-w-[260px] truncate text-[10.5px] text-ink-400">{r.ad_name || r.ad_id || r.form_name || r.form_id || "—"}</div>
                    </td>
                    <td className="td text-[12px]">{r.service_interest || "—"}</td>
                    <td className="td">
                      {r.lead_id ? (
                        <button className="text-left text-[12px] font-semibold text-brand-600 hover:underline" onClick={() => nav(`/leads?open=${r.lead_id}`)}>
                          {r.lead_code || `Lead #${r.lead_id}`}
                          <span className="block text-[10.5px] font-normal text-ink-400">{r.assigned_user_name ? `Assigned: ${r.assigned_user_name}` : "Unassigned"}</span>
                        </button>
                      ) : <span className="text-[11px] text-ink-400">Not linked</span>}
                    </td>
                    <td className="td">
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      {r.error && <div className="mt-1 max-w-[220px] truncate text-[10px] text-red-500" title={r.error}>{r.error}</div>}
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        {r.lead_id && <Btn size="xs" variant="outline" onClick={() => nav(`/leads?open=${r.lead_id}`)}><ExternalLink size={11} /> Open</Btn>}
                        {r.status === "Fetch Failed" && r.provider === "meta" && can("ads", "edit") && (
                          <Btn size="xs" variant="soft" loading={retrying === r.id} onClick={() => void retry(r)}><RefreshCw size={11} /> Retry</Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 pb-3"><Pagination page={page} pages={pages} onPage={setPage} total={total} shown={rows.length} /></div>
        </div>
      )}
    </div>
  );
}
