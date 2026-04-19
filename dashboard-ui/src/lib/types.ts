/**
 * Subconjunto de SessionInfo (WAHA GET /api/sessions).
 * @see WhatsPW/src/structures/sessions.dto.ts
 *
 * Presença na API usa WAHAPresenceStatus em minúsculas (online | offline | …).
 */
export type SessionRow = {
  name: string;
  status: string;
  config?: { metadata?: Record<string, string> };
  me?: {
    id?: string;
    jid?: string;
    lid?: string;
    pushName?: string;
  };
  /** Resposta real: enum em minúsculas; mocks podem usar maiúsculas */
  presence?: string | null;
  assignedWorker?: string;
  timestamps?: { activity: number | null };
  apps?: unknown[] | null;
};
