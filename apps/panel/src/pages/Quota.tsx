import {useConfirmation} from '../components/ConfirmationDialog';
import {BankedResetCredits} from '../components/BankedResetCredits';
import {canRedeemCredit,redemptionOutcome} from '../lib/banked-reset';
import {creditIdentity,beginCreditAttempt,readCreditAttempts,settleCreditAttempt} from '../lib/banked-reset-ledger';
import {ApiError} from '../lib/api';
import {quotaResetLabel} from "../lib/quota-reset-label";
import {Tabs} from "@radix-ui/themes";
import {useSearchParams} from "react-router-dom";
import {QuotaWindowInspector} from "../components/QuotaWindowInspector";
import "../components/quota-interactions.css";
import { TagFilter } from "../components/TagFilter.tsx";
import {ReadFreshness} from "../components/OperationalUI";
import {CardFrame} from "../components/OperationalUI";
import { usePreferences } from "../lib/preferences.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Pagination } from "../components/Pagination.tsx";
import { ProviderIcon } from "../components/ProviderIcon.tsx";
import { Modal } from "../lib/actions.tsx";
import { paginationState } from "../lib/pagination.ts";
import { api } from "../lib/api.ts";
import { Meter } from "../lib/charts.tsx";
import { DASH, int, providerLabel, when } from "../lib/format.ts";
import type { ProviderInfo, QuotaRow, QuotaWindow } from "../lib/types.ts";
import { useFetch } from "../lib/useFetch.ts";
import "./quota.css";

const quotaId: Record<string, string> = {
  "Unsupported":"Tidak didukung", "Rate-limit reset credit":"Kredit reset batas laju", "Redeem this credit":"Gunakan kredit ini", "Redeem earliest expiring credit":"Gunakan kredit terdekat kedaluwarsa", "Redeeming…":"Menggunakan kredit…", "Available banked resets":"Reset tersimpan tersedia", "No expiration reported":"Kedaluwarsa tidak dilaporkan", "Refresh inventory":"Muat ulang inventaris", "Querying upstream reset-credit inventory…":"Memeriksa inventaris kredit reset penyedia…",
  "Check this account’s inventory before reviewing a credit. No credit is spent automatically.":"Periksa inventaris akun ini sebelum meninjau kredit. Kredit tidak digunakan otomatis.",
  "No verified reset-credit API is available for this provider.":"API kredit reset terverifikasi tidak tersedia untuk penyedia ini.",
  "Spend one banked reset credit? This cannot be undone; the upstream service decides which exhausted limit is reset.":"Gunakan satu kredit reset tersimpan? Tindakan ini tidak dapat dibatalkan; penyedia menentukan batas mana yang direset.",
  "Outcome unknown. Do not redeem again. Review this account’s inventory and provider history before taking further action.":"Hasil belum diketahui. Jangan gunakan kredit lagi. Tinjau inventaris akun dan riwayat penyedia sebelum tindakan berikutnya.",
  "Safety storage unavailable. Redemption disabled; request diagnostics.":"Penyimpanan pengaman tidak tersedia. Penukaran dinonaktifkan; minta diagnostik.",
  "Outcome unknown. Inventory alone cannot prove which attempt succeeded. Redemption is locked for this account in this tab; request diagnostics. Attempt ID:":"Hasil belum diketahui. Inventaris saja tidak membuktikan percobaan mana yang berhasil. Penukaran akun ini dikunci pada tab ini; minta diagnostik. ID percobaan:",
  "Redemption rejected. Refresh inventory and review again before retrying.":"Penukaran ditolak. Segarkan inventaris dan tinjau kembali sebelum mencoba lagi.",
  "Request diagnostics. Attempt ID:":"Minta diagnostik. ID percobaan:",
  "Safety storage unavailable. No credit was sent. Redemption disabled; request diagnostics.":"Penyimpanan pengaman tidak tersedia. Kredit tidak dikirim. Penukaran dinonaktifkan; minta diagnostik.",
  "Reset time not reported":"Waktu reset tidak dilaporkan", "Reset time elapsed; check provider to verify allowance.":"Waktu reset terlewati; periksa penyedia untuk memverifikasi kuota.", "Checked locally":"Diperiksa secara lokal", "Check all eligible provider accounts":"Periksa semua akun penyedia yang memenuhi syarat", "Account Quota":"Kuota Akun", "Shared Pools":"Pool Kuota Bersama", "Quota workspace":"Ruang kerja kuota", "Pool name":"Nama pool", "Connect an account to create a pool, or retry account inventory if unavailable.":"Hubungkan akun untuk membuat pool, atau muat ulang inventaris akun jika tidak tersedia.",
  "Filter by tag": "Filter berdasarkan tag", "Apply tag filter": "Terapkan filter tag", "Clear tag filter": "Hapus filter tag",
  "Hide providers": "Sembunyikan penyedia", "Show providers": "Tampilkan penyedia", "No matching providers.": "Tidak ada penyedia yang cocok.",
  "Selected": "Dipilih", "Remaining unknown": "Sisa tidak diketahui", "Reset": "Reset",
  "Fresh": "Terbaru", "Cached": "Cache", "Stale": "Data lama", "Freshly checked": "Baru diperiksa",
  "Updated": "Diperbarui", "Time unknown": "Waktu tidak diketahui", "Quota unavailable": "Kuota tidak tersedia", "More quota windows": "Jendela kuota lainnya",
  "Token": "Token", "valid": "valid", "expired": "kedaluwarsa", "expiring": "akan kedaluwarsa", "refreshing": "sedang diperbarui", "refreshable": "dapat diperbarui",
  "Credit": "Kredit", "Unknown": "Tidak diketahui", "Observed": "Teramati", "Account cooldown": "Jeda akun", "Model cooldowns (this process only)": "Jeda model (hanya proses ini)",
  "Banked reset credits": "Kredit reset tersimpan", "Redeem reset": "Gunakan reset", "Reset credits": "Kredit reset",
};
function useQuotaTranslator() {
  const { t, language } = usePreferences();
  return (text: string, values?: Record<string, string | number>) => language === "id" && quotaId[text] ? quotaId[text] : t(text, values);
}

interface NodeInfo {
  id: string;
  name: string;
  prefix: string | null;
}

type Live = { busy?: boolean; data?: unknown; error?: string; previousWindows?: QuotaWindow[]; checkedAt?: string; snapshotAt?: string | null };

const fmtPct = (pct?: number | null) => {
  if (pct == null || Number.isNaN(pct)) return DASH;
  if (pct > 0 && pct < 1) return `${pct.toFixed(2)}%`;
  if (pct > 99 && pct < 100) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
};

const fmtUsedLimit = (w: { used?: number | null; total?: number | null; remaining?: number | null }) => {
  if (w.used != null && w.total != null) {
    // Magnitude is not unit evidence. The details retain unrounded values.
    return `${int(w.used)} / ${int(w.total)}`;
  }
  if (w.remaining != null) return `${int(w.remaining)} left`;
  return DASH;
};

export function Quota() {
  const tr = useQuotaTranslator();
  const [params,setParams]=useSearchParams();
  const workspace=params.get("tab")==="pools"?"pools":"accounts";
  const changeWorkspace=(tab:string)=>{const next=new URLSearchParams(params);next.set("tab",tab);setParams(next);};
  const inventory=useFetch<{connections?: {id:string;name:string|null;provider:string}[]}>(workspace==="pools"?"/api/connections":null);
  const poolConnections = inventory.status === "ok" ? (inventory.data.connections ?? []).map(a=>({connectionId:a.id,name:a.name ?? a.id,provider:a.provider})) : [];
  const [tagInput, setTagInput] = useState("");
  const [tag, setTag] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const state = useFetch<{ providers?: QuotaRow[] }>(`/api/usage/quota${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`);
  const provs = useFetch<{ providers?: ProviderInfo[] }>("/api/providers");
  const nodes = useFetch<{ nodes?: NodeInfo[] }>("/api/provider-nodes");
  const [live, setLive] = useState<Record<string, Live>>({});
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const confirmation = useConfirmation();
  const currentRows = useRef<QuotaRow[]>([]);
  currentRows.current = state.status === "ok" ? state.data.providers ?? [] : [];
  const resetRequest = useRef(0);
  const reviewBusy = useRef(false);
  useEffect(()=>()=>{resetRequest.current++;},[]);
  const uncertainAccounts = useRef(new Set<string>());
  const redeemBusy = useRef(false);
  const storageFailed = useRef(false);
  const [resetCreditTarget, setResetCreditTarget] = useState<QuotaRow | null>(null);
  const [resetCreditState, setResetCreditState] = useState<{
    loading: boolean;
    redeeming: boolean;
    availableCount: number | null;
    credits: Array<{
      selectionToken: string;
      resetType?: string;
      status?: string;
      grantedAt?: string;
      expiresAt?: string | null;
      title?: string;
      description?: string;
    }>;
    error: string | null;
  }>({ loading: false, redeeming: false, availableCount: null, credits: [], error: null });

  async function openResetCredits(row: QuotaRow) {
    if (redeemBusy.current || reviewBusy.current || row.provider !== "codex" || row.isActive === false) return;
    const request = ++resetRequest.current;
    setResetCreditTarget(Object.freeze({...row}));
    setResetCreditState({ loading: true, redeeming: false, availableCount: null, credits: [], error: null });
    try {
      const res = await api.get<{
        ok: boolean;
        availableCount?: number;
        credits?: Array<{
          selectionToken: string;
          resetType?: string;
          status?: string;
          grantedAt?: string;
          expiresAt?: string | null;
          title?: string;
          description?: string;
        }>;
      }>(`/api/usage/codex-reset-credit?connectionId=${encodeURIComponent(row.connectionId)}`);
      if (request !== resetRequest.current) return;
      if (!res.ok || !Array.isArray(res.credits)) throw new Error("Invalid reset-credit inventory response.");
      const identity = await creditIdentity(row.connectionId, "");
      if (request !== resetRequest.current) return;
      const attempts = readCreditAttempts(sessionStorage, identity.account);
      const unresolved = attempts.find(a=>a.status==='unknown');
      if (storageFailed.current) throw new Error(tr("Safety storage unavailable. Redemption disabled; request diagnostics."));
      if (unresolved || uncertainAccounts.current.has(row.connectionId)) throw new Error(tr("Outcome unknown. Inventory alone cannot prove which attempt succeeded. Redemption is locked for this account in this tab; request diagnostics. Attempt ID:") + " " + (unresolved?.attemptId ?? "unavailable"));
      const credits = [];
      for (const credit of res.credits) {
        const id = await creditIdentity(row.connectionId, credit.selectionToken);
        if (!attempts.some(a=>a.credit===id.credit && a.status==='committed')) credits.push(credit);
      }
      if (request !== resetRequest.current) return;
      setResetCreditState({
        loading: false,
        redeeming: false,
        availableCount: typeof res.availableCount === "number" && Number.isSafeInteger(res.availableCount) && res.availableCount >= 0 ? res.availableCount : null,
        credits,
        error: null,
      });
    } catch (e) {
      if (request !== resetRequest.current) return;
      setResetCreditState({
        loading: false,
        redeeming: false,
        availableCount: null,
        credits: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function closeResetCredits() {
    if (redeemBusy.current || reviewBusy.current) return;
    resetRequest.current++;
    setResetCreditTarget(null);
  }

  async function redeemResetCredit(creditId?: string) {
    if (!resetCreditTarget || redeemBusy.current || reviewBusy.current || uncertainAccounts.current.has(resetCreditTarget.connectionId)) return;
    const selected = creditId ?? resetCreditState.credits[0]?.selectionToken;
    const target = resetCreditTarget;
    if (!selected || !canRedeemCredit({...resetCreditState,provider:target.provider,isActive:target.isActive},selected)) return;
    const request = resetRequest.current;
    reviewBusy.current = true;
    const accepted = await confirmation.confirm({title:tr("Redeem reset"),description:tr("Spend one banked reset credit? This cannot be undone; the upstream service decides which exhausted limit is reset."),resource:`${target.provider} / ${target.name} / ${target.connectionId} · ${resetCreditState.credits.find(c=>c.selectionToken===selected)?.title ?? tr("Rate-limit reset credit")}`,action:tr("Redeem this credit"),danger:true});
    reviewBusy.current = false;
    if (!accepted || request !== resetRequest.current || redeemBusy.current) return;
    const current = currentRows.current.find(r=>r.connectionId===target.connectionId);
    if (!current || current.provider !== "codex" || current.isActive === false) return;
    redeemBusy.current = true;
    setResetCreditState(s => ({ ...s, redeeming: true, error: null }));
    let identity: Awaited<ReturnType<typeof creditIdentity>> | undefined;
    let attemptId: string | undefined;
    let dispatched = false;
    try {
      identity = await creditIdentity(target.connectionId, selected);
      const latest = currentRows.current.find(r=>r.connectionId===target.connectionId);
      if (request !== resetRequest.current || storageFailed.current || !latest || latest.provider !== 'codex' || latest.isActive === false) return;
      // Persist unknown synchronously before dispatch, including auth redirects/unmount.
      const attempt = beginCreditAttempt(sessionStorage, identity);
      attemptId = attempt.attemptId;
      const idempotencyKey = attempt.attemptId;
      dispatched = true;
      const res = await api.post<{ ok: boolean; outcome: string; usage?: unknown; quotaRefreshed?: boolean }>("/api/usage/codex-reset-credit", {
        connectionId: target.connectionId, idempotencyKey, creditId: selected,
      });
      if (redemptionOutcome(res) === "unknown") throw new Error("Unconfirmed redemption response.");
      settleCreditAttempt(sessionStorage, identity, attemptId, 'committed');
      if (request !== resetRequest.current) return;
      try { await api.get(`/api/usage/codex-reset-credit?connectionId=${encodeURIComponent(target.connectionId)}`); } catch { toast.error(tr("Credit redeemed; inventory read-back unavailable. Reload inventory before another review.")); }
      toast.success(res.outcome === "alreadyRedeemed" ? tr("This reset credit was already redeemed.") : tr("Codex confirmed the reset credit was redeemed."));
      if (res.quotaRefreshed !== true) toast.error(tr("Credit redeemed, but quota refresh is unavailable. Check quota separately; do not spend another credit to refresh it."));
      resetRequest.current++;
      setResetCreditTarget(null);
      // Retire potentially stale reset counts, including when the secondary refresh failed.
      setLive(l => ({ ...l, [target.connectionId]: { ...l[target.connectionId], data: res.usage ?? { _stale: true }, checkedAt: new Date().toISOString() } }));
      state.reload();
    } catch (e) {
      // Only these explicit existing server codes prove a rejection, not arbitrary HTTP errors.
      const code = e instanceof ApiError && e.body && typeof e.body === 'object' && 'code' in e.body ? e.body.code : null;
      const rejected = e instanceof ApiError && [400,404,409,503].includes(e.status) && ['invalid_request_body','connection_not_found','codex_provider_required','codex_oauth_required','exclusive_lease_active','redemption_capacity','selected_credit_unavailable','no_credit','nothing_to_reset'].includes(String(code));
      if (rejected && identity && attemptId) {
        try { settleCreditAttempt(sessionStorage, identity, attemptId, 'rejected'); }
        catch { storageFailed.current = true; }
        if (request !== resetRequest.current) return;
        setResetCreditState({loading:false,redeeming:false,credits:[],availableCount:null,error:tr("Redemption rejected. Refresh inventory and review again before retrying.")});
        return;
      }
      if (!dispatched) storageFailed.current = true;
      uncertainAccounts.current.add(target.connectionId);
      if (request !== resetRequest.current) return;
      const msg = tr("Outcome unknown. Do not redeem again. Review this account’s inventory and provider history before taking further action.") + " " + (dispatched ? `${tr("Request diagnostics. Attempt ID:")} ${attemptId}` : tr("Safety storage unavailable. No credit was sent. Redemption disabled; request diagnostics."));
      setResetCreditState(s => ({ ...s, redeeming: false, credits: [], availableCount: null, error: msg }));
      toast.error(msg);
    } finally {
      redeemBusy.current = false;
    }
  }

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of provs.status === "ok" ? provs.data.providers ?? [] : []) {
      m.set(p.id, p.name ?? p.id);
    }
    for (const n of nodes.status === "ok" ? nodes.data.nodes ?? [] : []) {
      m.set(n.id, n.prefix ? `${n.name} (${n.prefix})` : n.name);
    }
    return m;
  }, [provs, nodes]);

  async function refresh(id: string) {
    const cachedRow = state.status === "ok" ? state.data.providers?.find(r => r.connectionId === id) : undefined;
    const cached = cachedRow?.windows ?? [];
    setLive((l) => {
      const previous = l[id];
      const earlier = mergeWindows(previous?.previousWindows ?? [], cached);
      const priorStale = asRecord(previous?.data)?._stale === true;
      const priorLive = previous?.data === undefined ? [] : toWindows(state.status === "ok" ? state.data.providers?.find(r => r.connectionId === id)?.provider ?? "" : "", previous.data).map(w => ({ ...w, fetchedAt: priorStale ? null : previous.checkedAt ?? null, stale: priorStale }));
      return { ...l, [id]: { ...previous, busy: true, error: undefined, previousWindows: priorStale ? mergeWindows(priorLive, earlier) : mergeWindows(earlier, priorLive) } };
    });
    try {
      const data = await api.get<unknown>(`/api/usage/${encodeURIComponent(id)}`);
      setLive((l) => ({ ...l, [id]: { ...l[id], busy: false, data, checkedAt: new Date().toISOString(), snapshotAt: cachedRow?.fetchedAt ?? null } }));
      state.reload();
      const response = asRecord(data);
      if (response?._stale === true || typeof response?.message === "string") {
        toast.error(String(response._staleReason ?? response.message ?? "Quota data is stale"));
      } else toast.success("Account quota refreshed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLive((l) => ({ ...l, [id]: { ...l[id], busy: false, error: msg } }));
      toast.error(msg);
    }
  }

  async function checkGroup(rows: QuotaRow[]) {
    const checkable = rows.filter((r) => r.quotaSupported !== false && r.isActive !== false);
    if (checkable.length === 0) return;
    for (const r of checkable) await refresh(r.connectionId);
  }

  async function syncAllNow() {
    setSyncingAll(true);
    setSyncSummary(null);
    try {
      const res = await api.post<{ succeeded?: number; total?: number; failed?: number }>("/api/usage/provider-limits");
      const msg = `Synced ${res?.succeeded ?? 0}/${res?.total ?? 0} accounts${res?.failed ? ` (${res.failed} failed)` : ""}.`;
      setSyncSummary(msg);
      toast.success(msg);
      state.reload();
    } catch (e) {
      const msg = `Sync failed: ${e instanceof Error ? e.message : String(e)}`;
      setSyncSummary(msg);
      toast.error(msg);
    } finally {
      setSyncingAll(false);
    }
  }

  return (
    <div className="page quota-page">
      {confirmation.dialog}
      {workspace === "accounts" && <ReadFreshness state={state} />}<ReadFreshness resource="Providers" state={provs}/><ReadFreshness resource="Custom Providers" state={nodes}/>
      <h1>{tr("Quota")}</h1>
      <p className="muted">{tr("Choose a provider to explore account allowances, model windows, and reset times. Quotas are cached until refreshed.")}</p>
      <Tabs.Root value={workspace} onValueChange={changeWorkspace} activationMode="manual">
       <Tabs.List aria-label={tr("Quota workspace")}><Tabs.Trigger value="accounts">{tr("Account Quota")}</Tabs.Trigger><Tabs.Trigger value="pools">{tr("Shared Pools")}</Tabs.Trigger></Tabs.List>
       <Tabs.Content value="accounts" forceMount hidden={workspace !== "accounts"}>
      <div className="toolbar">
        <button type="button" className="btn-add" disabled={syncingAll} onClick={syncAllNow}>
          {syncingAll ? tr("Syncing all…") : tr("Sync all quotas")}
        </button>
        <button type="button" className="btn-ghost" onClick={state.reload}>{tr("Reload cached view")}</button>
        {syncSummary && <span className="muted">{syncSummary}</span>}
      </div>
      <TagFilter value={tagInput} applied={tag} onChange={setTagInput} tr={tr}
        onApply={() => setTag(tagInput.trim())} onClear={() => { setTagInput(""); setTag(""); }} />
      {state.status === "loading" && <p>{tr("Loading...")}</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && !state.data.providers?.length && <p className="muted">{tag ? tr("No matching accounts.") : tr("No accounts connected.")}</p>}
      {state.status === "ok" && <QuotaBrowser rows={state.data.providers ?? []} names={names} live={live} syncingAll={syncingAll} onRefresh={refresh} onCheckGroup={checkGroup} selectedProvider={selectedProvider} onSelectProvider={setSelectedProvider} onOpenResetCredits={openResetCredits} />}
       </Tabs.Content>
       <Tabs.Content value="pools"><ReadFreshness resource="Account inventory" state={inventory}/><QuotaPoolsSection connections={poolConnections}/></Tabs.Content>
      </Tabs.Root>
      <Modal
        open={resetCreditTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeResetCredits();
        }}
        title={tr("Codex Banked Reset Credits")}
        description={
          resetCreditTarget
            ? `${resetCreditTarget.name} (${resetCreditTarget.connectionId})`
            : ""
        }
      >
        {resetCreditTarget && (
          <div className="stack-form">
            <p className="muted" style={{ margin: 0 }}>
              {tr("Availability and reset eligibility are determined by Codex. Redeeming spends one credit and cannot be undone. A reset does not guarantee all quota windows are cleared.")}
            </p>
            <div className="card" style={{ padding: 12 }}>
              <div>
                {tr("Available banked resets")}: <strong>{resetCreditState.availableCount ?? tr("Unknown")}</strong>
              </div>
              {resetCreditState.loading && (
                <p className="muted" style={{ margin: "8px 0 0" }}>{tr("Querying upstream reset-credit inventory…")}</p>
              )}
              {resetCreditState.error && (
                <p className="bad" style={{ margin: "8px 0 0" }}>{resetCreditState.error}</p>
              )}
              {!resetCreditState.loading && resetCreditState.credits.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  {resetCreditState.credits.map((c) => (
                    <div
                      key={c.selectionToken}
                      className="card"
                      style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                    >
                      <div>
                        <strong>{c.title ?? c.resetType ?? tr("Rate-limit reset credit")}</strong>
                        {c.description && <div className="muted">{c.description}</div>}
                        <small className="muted">
                          {c.expiresAt ? `${tr("Expires")}: ${when(c.expiresAt)}` : tr("No expiration reported")}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="btn-add"
                        disabled={resetCreditState.redeeming || !canRedeemCredit({...resetCreditState,provider:resetCreditTarget.provider,isActive:resetCreditTarget.isActive},c.selectionToken)}
                        onClick={() => void redeemResetCredit(c.selectionToken)}
                      >
                        {resetCreditState.redeeming ? tr("Redeeming…") : tr("Redeem this credit")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="btn-add"
                disabled={resetCreditState.redeeming || !canRedeemCredit({...resetCreditState,provider:resetCreditTarget.provider,isActive:resetCreditTarget.isActive},resetCreditState.credits[0]?.selectionToken ?? "")}
                onClick={() => void redeemResetCredit()}
              >
                {resetCreditState.redeeming ? tr("Redeeming…") : tr("Redeem earliest expiring credit")}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={resetCreditState.loading || resetCreditState.redeeming || reviewBusy.current}
                onClick={() => void openResetCredits(resetCreditTarget)}
              >
                {tr("Refresh inventory")}
              </button>
              <button type="button" className="btn-ghost" onClick={closeResetCredits}>
                {tr("Close")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

interface QuotaPoolItem {
  id: string;
  name: string;
  connectionId: string;
  connectionIds?: string[];
  exclusive?: boolean;
}

function QuotaPoolsSection({ connections }: { connections: {connectionId:string;name:string;provider:string}[] }) {
  const tr = useQuotaTranslator();
  const confirmation = useConfirmation();
  const removeBusy = useRef(false);
  const poolsState = useFetch<{ pools?: QuotaPoolItem[]; total?: number }>("/api/quota/pools");
  const [poolName, setPoolName] = useState("");
  const [connId, setConnId] = useState("");
  const [busy, setBusy] = useState(false);
  const pools = poolsState.status === "ok" ? poolsState.data.pools ?? [] : [];

  async function createPoolNow(e: React.FormEvent) {
    e.preventDefault();
    const targetConn = connId || connections[0]?.connectionId || "";
    if (busy || !poolName.trim() || !connections.some(c=>c.connectionId===targetConn)) return;
    setBusy(true);
    try {
      await api.post("/api/quota/pools", {
        name: poolName.trim(),
        connectionId: targetConn,
        connectionIds: [targetConn],
      });
      toast.success(`Created quota pool “${poolName.trim()}”`);
      setPoolName("");
      poolsState.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removePool(id: string) {
    if(removeBusy.current)return;
    const target=pools.find(p=>p.id===id);if(!target)return;
    removeBusy.current=true;
    const accepted=await confirmation.confirm({title:tr("Delete quota pool?"),description:tr("Remove this shared pool and its generated routing combo. Account credentials are not deleted."),resource:`${target.name} / ${target.id}`,action:tr("Delete"),danger:true});
    if(!accepted){removeBusy.current=false;return;}
    setBusy(true);
    try {
      await api.delete(`/api/quota/pools/${encodeURIComponent(id)}`);
      toast.success("Quota pool removed");
      poolsState.reload();
    } catch (err) {
      toast.error("Outcome unknown; reload pools before attempting another deletion. " + (err instanceof Error ? err.message : String(err)));
    } finally {
      removeBusy.current=false;
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ padding: 14, marginTop: 20 }}>
      {confirmation.dialog}
      <ReadFreshness resource="Quota pools" state={poolsState}/><h2>{tr("Shared Pools")}</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          {tr("Group accounts into named quota-share pools (auto-minting quotaShared-* routing combos).")}
        </p>
        {!connections.length && <p className="muted">{tr("Connect an account to create a pool, or retry account inventory if unavailable.")}</p>}
        {(
          <form onSubmit={createPoolNow} className="toolbar" style={{ marginBottom: 0 }}>
            <input
              type="text"
              aria-label={tr("Pool name")} placeholder={tr("Pool name (e.g. team-alpha)")}
              value={poolName}
              onChange={(e) => setPoolName(e.target.value)}
              disabled={busy}
            />
            <select
              aria-label={tr("Primary account")}
              value={connId || connections[0]?.connectionId || ""}
              onChange={(e) => setConnId(e.target.value)}
              disabled={busy}
            >
              {connections.map((c) => (
                <option key={c.connectionId} value={c.connectionId}>
                  {c.name} ({c.provider})
                </option>
              ))}
            </select>
            <button type="submit" className="btn-add" disabled={busy || !poolName.trim() || !connections.some(c=>c.connectionId===(connId || connections[0]?.connectionId))}>
              {tr("Create pool")}
            </button>
          </form>
        )}
        {pools.length > 0 && (
          <div style={{ display: "grid", gap: 8 }}>
            {pools.map((p) => (
              <div
                key={p.id}
                className="card"
                style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span>
                  <strong>{p.name}</strong> · <code>{p.id.slice(0, 8)}</code>
                </span>
                <button type="button" className="btn-danger" disabled={busy} onClick={() => void removePool(p.id)}>
                  {tr("Delete")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function quotaPage(rows: QuotaRow[], search: string, requestedPage: number, pageSize = 8) {
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(r => !query || `${r.name} ${r.plan ?? ""}`.toLowerCase().includes(query));
  const { page, pages, total, pageSize: size } = paginationState(filtered.length, pageSize, requestedPage);
  return { rows: filtered.slice((page - 1) * size, page * size), total, pages, page };
}

export function QuotaBrowser({ rows, names, live, syncingAll, onRefresh, onCheckGroup, selectedProvider, onSelectProvider, onOpenResetCredits }: {
  rows: QuotaRow[]; names: Map<string, string>; now?: number; live: Record<string, Live>; syncingAll: boolean;
  onRefresh: (id: string) => void; onCheckGroup: (rows: QuotaRow[]) => void;
  selectedProvider?: string; onSelectProvider?: (provider: string) => void;
  onOpenResetCredits?: (row: QuotaRow) => void;
}) {
  const tr = useQuotaTranslator();
  const [localSelected, setLocalSelected] = useState(rows[0]?.provider ?? "");
  const selected = selectedProvider === undefined ? localSelected : selectedProvider;
  const setSelected = onSelectProvider ?? setLocalSelected;
  const [search, setSearch] = useState("");
  const [providerSearch, setProviderSearch] = useState("");
  const [showProviders, setShowProviders] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const providers = [...new Set(rows.map(r => r.provider))];
  const current = providers.includes(selected) ? selected : providers[0];
  const pool = rows.filter(r => r.provider === current);
  const result = quotaPage(pool, search, page, pageSize);
  // Keep controlled state in sync when cached data removes pages or providers.
  if (page !== result.page) setPage(result.page);
  const busy = syncingAll || Object.values(live).some(l => l.busy);
  return <>
    <section className="quota-selector" aria-label={tr("Provider categories")}>
      <div className="toolbar quota-selector-toolbar">
        <input aria-label={tr("Search providers")} type="search" placeholder={tr("Search providers")} value={providerSearch} onChange={e => setProviderSearch(e.target.value)} />
        <button type="button" className="btn-ghost" aria-expanded={showProviders} aria-controls="quota-provider-list" onClick={() => setShowProviders(v => !v)}>{showProviders ? tr("Hide providers") : tr("Show providers")}</button>
      </div>
      {showProviders && <div id="quota-provider-list" className="quota-provider-grid">
        {providers.filter(provider => `${provider} ${providerLabel(provider, names)}`.toLowerCase().includes(providerSearch.trim().toLowerCase())).map(provider => {
          const count = rows.filter(r => r.provider === provider).length;
          const label = providerLabel(provider, names);
          return <button type="button" key={provider} className="quota-provider" aria-pressed={provider === current} onClick={() => { setSelected(provider); setPage(1); }}>
            <ProviderIcon providerId={provider} label={label} size={32} />
            <span className="quota-provider-label"><strong>{label}</strong><small>{count} {tr(count === 1 ? "account" : "accounts")}</small></span>
            {provider === current && <span className="quota-selected">{tr("Selected")}</span>}
          </button>;
        })}
      </div>}
      {showProviders && providers.length > 0 && !providers.some(provider => `${provider} ${providerLabel(provider, names)}`.toLowerCase().includes(providerSearch.trim().toLowerCase())) && <p className="muted">{tr("No matching providers.")}</p>}
    </section>
    <div className="toolbar">
      <input aria-label={tr("Search accounts")} type="search" placeholder={tr("Search accounts")} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <span className="muted">{result.total} {tr(result.total === 1 ? "account" : "accounts")}</span>
      <button className="btn-ghost" disabled={busy || !pool.some(r => r.quotaSupported !== false && r.isActive !== false)} onClick={() => onCheckGroup(pool)}>{tr("Check all eligible provider accounts")}</button>
    </div>
    <div className="quota-account-grid">
      {result.rows.map(row => {
        const status = live[row.connectionId];
        const response = asRecord(status?.data);
        const rawLive = status?.data !== undefined ? toWindows(row.provider, status.data) : [];
        const fresh: QuotaWindow[] = rawLive.map(w => ({ ...w, fetchedAt: response?._stale === true ? null : status?.checkedAt ?? null, stale: response?._stale === true }));
        const baseline = mergeWindows(status?.previousWindows ?? [], row.windows ?? []);
        const cachedNewer = status?.snapshotAt !== undefined
          ? !!row.fetchedAt && row.fetchedAt !== status.snapshotAt
          : !!(status?.checkedAt && row.fetchedAt && Date.parse(row.fetchedAt) > Date.parse(status.checkedAt));
        // Stale responses may contain a merged cache with mixed timestamps; prefer
        // snapshot provenance and retain only response windows absent from it.
        const windows = cachedNewer ? baseline : response?._stale === true ? mergeWindows(fresh, baseline) : mergeWindows(baseline, fresh);
        const stale = (!cachedNewer && response?._stale === true) || !!status?.error;
        const warning = status?.error ?? (typeof response?._staleReason === "string" ? response._staleReason : null) ?? (typeof response?.message === "string" ? response.message : null) ?? row.message;
        const plan = !cachedNewer && typeof response?.plan === "string" ? response.plan : row.plan;
        const resetObservation = !cachedNewer && response ? response.bankedResetCredits : row.bankedResetCredits;
        const bankedResetCredits = typeof resetObservation === "number" && Number.isSafeInteger(resetObservation) && resetObservation >= 0 ? resetObservation : null;
        const fetched = stale ? (typeof response?._staleSince === "string" ? response._staleSince : row.fetchedAt) : (!cachedNewer && fresh.length && status?.checkedAt ? status.checkedAt : row.fetchedAt);
        const renderWindow = (w: QuotaWindow) => {
          const reset = quotaResetLabel(w.resetAt);
          const isFresh = !stale && !cachedNewer && w.stale !== true && fresh.includes(w);
          return <section className="quota-window" key={w.key}>
            <div className="quota-window-head"><strong>{tr(w.label)}</strong><span>{w.unlimited ? tr("Unlimited") : w.percentRemaining != null ? tr("{0} left", {0: fmtPct(w.percentRemaining)}) : tr("Remaining unknown")}</span></div>
            {!w.unlimited && w.remaining != null && <p className="quota-remaining">{tr("Remaining")}: <strong>{w.remaining}</strong>{w.total != null ? ` / ${w.total}` : ""}</p>}
            {w.percentRemaining != null && (!Number.isFinite(w.percentRemaining) || w.percentRemaining < 0 || w.percentRemaining > 100) && <p className="bad">{tr("Invalid upstream percentage; meter is display-clamped. See window details.")}</p>}
            {w.percentRemaining != null && Number.isFinite(w.percentRemaining) && !w.unlimited && <Meter value={w.percentRemaining} />}
            <div className="quota-window-head"><span>{w.used != null && w.total != null ? tr("{0} used", {0: fmtUsedLimit(w)}) : fmtUsedLimit(w)}</span><span>{tr("Reset")}: {reset.kind === "unknown" ? tr(reset.label) : reset.label}</span></div>
            <small className="muted">{stale || w.stale || (!cachedNewer && fresh.length > 0 && !isFresh) ? tr("Stale") : isFresh ? tr("Fresh") : tr("Cached")} · {w.fetchedAt ? `${tr(isFresh ? "Checked locally" : "Updated")}: ${when(w.fetchedAt)}` : tr("Time unknown")}</small>
            {reset.kind === "past" && <p className="muted">{tr("Reset time elapsed; check provider to verify allowance.")}</p>}
            {!!w.models?.length && <details><summary>{tr("Models (")}{w.models.length})</summary>{w.models.join(", ")}</details>}
          </section>;
        };
        return <CardFrame as="article" kind="quota" className="quota-account" key={row.connectionId}>
          <header><div className="quota-account-identity"><ProviderIcon providerId={row.provider} label={providerLabel(row.provider,names)} size={24}/><div><h3>{row.name}</h3><small className="muted">{providerLabel(row.provider,names)}</small><span className="vendor-badge">{plan ?? tr("Plan unknown")}</span></div></div><button type="button" className="btn-ghost" disabled={busy || row.isActive === false || row.quotaSupported === false} onClick={() => onRefresh(row.connectionId)}>{status?.busy ? tr("Checking…") : tr("Check now")}</button></header>
          <div className={row.isActive === false ? "muted" : tokenTone(row.tokenStatus)}>{row.isActive === false && <>{tr("Disabled ·")} </>}{tr("Token")}: {tr(row.tokenStatus)}</div>
          {(row.provider === "codex" || row.provider === "claude") && <BankedResetCredits provider={row.provider} accountId={row.connectionId} count={bankedResetCredits} stale={stale || !!row.bankedResetCreditsStale} disabled={busy || row.isActive === false} onReview={onOpenResetCredits?()=>onOpenResetCredits(row):undefined} tr={tr}/>}
          {row.provider === "codebuddy-cn" && <>
            <div>{tr("Credit")}: {tr(row.creditStatus === "observed" ? (stale ? "Stale" : "Observed") : row.creditStatus === "stale" ? "Stale" : "Unknown")}</div>
            {row.accountCooldownUntil && <div>{tr("Account cooldown")}: {when(row.accountCooldownUntil)}</div>}
            {!!row.modelCooldowns?.length && <details className="quota-more quota-cooldowns"><summary>{tr("Model cooldowns (this process only)")} ({row.modelCooldowns.length})</summary>{row.modelCooldowns.map((lock, i) => <div key={`${lock.model}:${i}`}>{lock.model} · {lock.reason} · {when(lock.until)}</div>)}</details>}
          </>}
          <p className="quota-fetched muted">{stale ? tr("Stale") : fresh.length && !cachedNewer ? tr("Freshly checked") : tr("Cached")} · {fetched ? `${tr("Updated")}: ${when(fetched)}` : tr("Never synced")}</p>
          {warning && <p className="bad" role="status">{warning}</p>}
          {row.quotaSupported === false ? <p className="muted">{tr("Upstream quota API unavailable")}</p> : windows.length === 0 ? <p className="muted">{row.fetchedAt ? tr("Quota unavailable") : tr("Not synced yet")}</p> : <>
            <QuotaWindowInspector windows={windows} renderWindow={renderWindow}/>
          </>}
        </CardFrame>;
      })}
    </div>
    {!result.total && <p className="muted">{tr("No matching accounts.")}</p>}
    <Pagination total={result.total} page={result.page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="accounts" />
  </>;
}

const asRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** New observations replace only matching windows/models; retain unreported cached data. */
export function mergeWindows(cached: QuotaWindow[], fresh: QuotaWindow[]): QuotaWindow[] {
  const freshModels = new Set(fresh.flatMap(w => w.models ?? []));
  const freshKeys = new Set(fresh.map(w => w.key));
  const retained = cached.flatMap(w => {
    if (freshKeys.has(w.key) && !w.models?.length) return [];
    if (!w.models?.length) return [w];
    const models = w.models.filter(m => !freshModels.has(m));
    return models.length ? [{ ...w, key: freshKeys.has(w.key) ? `${w.key}:cached` : w.key, models }] : [];
  });
  return [...fresh, ...retained];
}

function toWindows(provider: string, data: unknown): QuotaWindow[] {
  const q = (data as { quotas?: unknown } | null)?.quotas;
  const entries: [string, unknown][] = Array.isArray(q)
    ? q.map((v, i) => [String((v as { name?: string })?.name ?? `window ${i + 1}`), v])
    : q && typeof q === "object"
      ? Object.entries(q)
      : [];
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const out: QuotaWindow[] = [];

  for (const [rawKey, v] of entries) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const unknownFraction = (provider === "antigravity" || provider === "agy") && o.fractionReported === false;
    const used = unknownFraction ? null : n(o.used);
    const total = unknownFraction ? null : n(o.total);
    const remaining = unknownFraction ? null : n(o.remaining);
    let pct = unknownFraction ? null : n(o.remainingPercentage);
    if (total != null && total > 0) {
      const exactRem = remaining != null ? Math.max(0, Math.min(total, remaining)) : used != null ? Math.max(0, total - used) : null;
      if (exactRem != null && (pct === null || (pct === 0 && exactRem > 0))) {
        pct = (exactRem / total) * 100;
      }
    }
    const resetAt = typeof o.resetAt === "string" && o.resetAt ? o.resetAt : null;
    const unlimited = o.unlimited === true;

    if (provider === "antigravity" || provider === "agy") {
      const k = rawKey.toLowerCase();
      const fam = k.startsWith("gemini-4-argon")
        ? { id: "argon", label: "Gemini 4 Argon" }
        : k.startsWith("claude-") || k.startsWith("gpt-oss")
          ? { id: "claude", label: "Claude / GPT-OSS" }
          : k.startsWith("gemini-3")
            ? { id: "flash", label: "Gemini 3 Flash" }
            : { id: rawKey, label: rawKey };
      const groupKey = `${fam.id}:${total ?? -1}:${used ?? -1}:${remaining ?? -1}:${pct ?? -1}:${resetAt ?? ""}:${unlimited}`;
      const existing = out.find((w) => w.key === groupKey);
      if (existing) {
        existing.models = [...(existing.models ?? []), rawKey];
        continue;
      }
      out.push({ key: groupKey, label: fam.label, models: [rawKey], used, total, remaining, percentRemaining: pct, resetAt, unlimited });
    } else {
      const label =
        rawKey === "session"
          ? "5h Session"
          : rawKey === "weekly"
            ? "Weekly"
            : typeof o.displayName === "string" && o.displayName.trim()
              ? o.displayName.trim()
              : rawKey;
      out.push({ key: rawKey, label, models: [rawKey], used, total, remaining, percentRemaining: pct, resetAt, unlimited });
    }
  }
  return out;
}

const tokenTone = (s: string) => (s === "valid" ? "ok" : s === "refreshable" || s === "expiring" || s === "refreshing" ? "muted" : "bad");
