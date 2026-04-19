export function formatActivity(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) {
    return '—';
  }
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

export function shortJid(jid: string | undefined): string {
  if (!jid) {
    return '—';
  }
  return jid.length > 28 ? `${jid.slice(0, 14)}…${jid.slice(-10)}` : jid;
}

/** Rótulos em PT para presença WAHA (API em minúsculas) */
export function presenceLabel(raw: string | null | undefined): string {
  if (raw == null || raw === '') {
    return '—';
  }
  const k = raw.toLowerCase();
  const map: Record<string, string> = {
    online: 'Online',
    offline: 'Offline',
    typing: 'A escrever',
    recording: 'A gravar',
    paused: 'Pausado',
  };
  return map[k] ?? raw;
}

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

/** Cor semântica para badge de estado da sessão */
export function sessionStatusTone(status: string): StatusTone {
  switch (status) {
    case 'WORKING':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'STARTING':
    case 'SCAN_QR_CODE':
      return 'accent';
    case 'STOPPED':
    default:
      return 'neutral';
  }
}

export function presenceTone(
  raw: string | null | undefined,
): StatusTone | 'muted' {
  if (raw == null || raw === '') {
    return 'muted';
  }
  const k = raw.toLowerCase();
  if (k === 'online') {
    return 'success';
  }
  if (k === 'offline') {
    return 'neutral';
  }
  if (k === 'typing' || k === 'recording') {
    return 'accent';
  }
  return 'neutral';
}

/** Estados possíveis (alinhado a WAHASessionStatus) */
export const SESSION_STATUS_OPTIONS = [
  'STOPPED',
  'STARTING',
  'SCAN_QR_CODE',
  'WORKING',
  'FAILED',
] as const;
