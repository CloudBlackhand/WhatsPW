import { useCallback, useEffect, useState } from 'react';
import { SessionsTable } from './SessionsTable';
import { fetchSessions, mockSessions } from './lib/sessions';
import type { SessionRow } from './lib/types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; rows: SessionRow[]; source: 'api' | 'mock' };

export default function App() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [includeStopped, setIncludeStopped] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const rows = await fetchSessions(includeStopped);
      setState({ kind: 'ok', rows, source: 'api' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({
        kind: 'ok',
        rows: mockSessions(),
        source: 'mock',
      });
      console.warn('[WhatsPW dashboard]', msg, '→ a usar dados de exemplo');
    }
  }, [includeStopped]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem' }}>
      <header
        style={{
          marginBottom: '1.25rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '1.35rem' }}>WhatsPW</h1>
          <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
            Sessões · TanStack Table: filtro global, filtro por estado, ordenação e paginação.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.9rem',
              color: '#334155',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={includeStopped}
              onChange={(e) => setIncludeStopped(e.target.checked)}
            />
            Incluir paradas (<code>?all=true</code>)
          </label>
          <button
            type="button"
            onClick={() => void load()}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#fff',
            }}
          >
            Atualizar
          </button>
        </div>
      </header>

      {state.kind === 'loading' && <p>A carregar…</p>}

      {state.kind === 'ok' && (
        <>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
            Fonte:{' '}
            <strong>{state.source === 'api' ? 'API WAHA' : 'exemplo (API indisponível)'}</strong>
            {import.meta.env.DEV && (
              <>
                {' '}
                · <code>npm run dev</code> + proxy; opcional <code>VITE_WAHA_API_KEY</code> no{' '}
                <code>.env</code>
              </>
            )}
          </p>
          <SessionsTable data={state.rows} />
        </>
      )}
    </div>
  );
}
