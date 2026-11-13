import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import { decodeUpstreamError } from '../lib/error-decoder.ts';
import './inference-summary.css';

export type InferenceResult = { ok?: boolean; status?: string; output?: string; finishReason?: string; usage?: Record<string, number> | null; httpStatus?: number; observedAt?: string; error?: string; model?: string };

export function InferenceSummary({ result, language, locale, provider, onDetails }: { result: InferenceResult; language: string; locale: string; provider?: string; onDetails: () => void }) {
 const id = language === 'id';
 const status = result.status === 'success' ? 'success' : result.status === 'failed' ? 'failed' : 'unknown';
 const label = status === 'success' ? (id ? 'Berhasil' : 'Success') : status === 'failed' ? (id ? 'Gagal' : 'Failed') : (id ? 'Tidak diketahui' : 'Unknown');
 const Icon = status === 'success' ? CheckCircle2 : status === 'failed' ? XCircle : CircleHelp;
 const date = result.observedAt && /(?:Z|[+-]\d{2}:\d{2})$/.test(result.observedAt) ? new Date(result.observedAt) : null;
 const valid = date && Number.isFinite(date.getTime());
 const zone = new Intl.DateTimeFormat(locale).resolvedOptions().timeZone;
 const short = valid ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date) : (id ? 'Waktu tidak tersedia' : 'Time unavailable');
 const clock = valid ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date) : '';
 const full = valid ? `${new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'long' }).format(date)} · ${zone}` : '';
 // Only decoder-owned copy is displayed here, never arbitrary upstream errors or credentials.
 const decoded = status === 'failed' && result.error ? decodeUpstreamError({ provider, status: result.httpStatus, error: result.error }) : null;
 const timeout = status === 'failed' && /\btimeout\b|timed out/i.test(result.error ?? '');
 const reasonsId: Record<string, string> = { CBCN_11102_MODEL_NOT_FOUND: 'Model tidak dilayani gateway (11102)', CBCN_11101_STREAM_REQUIRED: 'Gateway memerlukan streaming (11101)', CBAI_11128_CHANNEL: 'Verifikasi sesi ditolak (11128)', STREAM_EARLY_EOF: 'Stream ditutup tanpa keluaran', UPSTREAM_CLIENT_UNSUPPORTED: 'Versi klien tidak didukung', UPSTREAM_AUTH_EXPIRED: 'Kredensial ditolak upstream', UPSTREAM_ACCOUNT_BLOCKED: 'Akun dibatasi upstream', UPSTREAM_FORBIDDEN: 'Akses upstream ditolak (403)', UPSTREAM_429_RATE_LIMIT: 'Kuota atau batas permintaan upstream (429)', CONTEXT_LENGTH_EXCEEDED: 'Input melebihi batas konteks', UPSTREAM_5XX_UNAVAILABLE: 'Kesalahan server upstream', UPSTREAM_GENERIC_ERROR: 'Permintaan upstream gagal' };
 const reason = timeout ? (id ? 'Permintaan kehabisan waktu' : 'Request timed out') : decoded ? (id ? reasonsId[decoded.code] ?? 'Permintaan upstream gagal' : decoded.title) : '';
 const hasDetails = !!(result.error || result.model || result.httpStatus != null || result.output || result.finishReason || result.usage);
 return <div className="inference-summary" role="status">
  <div className="inference-summary-heading"><span>{id ? 'Tes model terakhir' : 'Last model test'}</span><span className={`inference-summary-status ${status === 'success' ? 'ok' : status === 'failed' ? 'bad' : 'muted'}`}><Icon size={14} aria-hidden="true" />{label}</span></div>
  {valid ? <details className="inference-summary-time"><summary title={full} aria-label={full}><time dateTime={date.toISOString()}><span>{short}</span><span>{clock}</span></time></summary><span>{full}</span></details> : <span className="inference-summary-time muted">{short}</span>}
  {reason && <span className="inference-summary-reason">{reason}</span>}
  {hasDetails && <button type="button" className="btn-ghost inference-summary-details" aria-label={id ? 'Buka detail tes' : 'Open test details'} onClick={onDetails}>{id ? 'Detail' : 'Details'}</button>}
 </div>;
}
