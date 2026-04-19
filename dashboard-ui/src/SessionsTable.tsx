import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { useMemo, useState, type ReactNode } from 'react';
import {
  formatActivity,
  presenceLabel,
  presenceTone,
  sessionStatusTone,
  SESSION_STATUS_OPTIONS,
  shortJid,
} from './lib/format';
import type { SessionRow } from './lib/types';

const columnHelper = createColumnHelper<SessionRow>();

type Props = {
  data: SessionRow[];
};

function globalFilterFn(
  row: { original: SessionRow },
  _columnId: string,
  filterValue: string,
): boolean {
  const q = filterValue.trim().toLowerCase();
  if (!q) {
    return true;
  }
  const s = row.original;
  const hay = [
    s.name,
    s.status,
    s.presence ?? '',
    s.assignedWorker ?? '',
    s.me?.pushName ?? '',
    s.me?.jid ?? '',
    s.me?.id ?? '',
    String(s.apps?.length ?? ''),
    s.config?.metadata
      ? Object.entries(s.config.metadata)
          .map(([k, v]) => `${k} ${v}`)
          .join(' ')
      : '',
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function Badge({
  tone,
  children,
}: {
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' | 'muted';
  children: ReactNode;
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={sessionStatusTone(status)}>{status}</Badge>;
}

function PresenceBadge({ presence }: { presence: string | null | undefined }) {
  const label = presenceLabel(presence);
  if (label === '—') {
    return <Badge tone="muted">{label}</Badge>;
  }
  return <Badge tone={presenceTone(presence)}>{label}</Badge>;
}

export function SessionsTable({ data }: Props) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'name', desc: false },
  ]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });

  const statusValuesInData = useMemo(() => {
    const set = new Set<string>();
    for (const row of data) {
      if (row.status) {
        set.add(row.status);
      }
    }
    return Array.from(set).sort();
  }, [data]);

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Sessão',
        cell: (info) => <strong>{info.getValue()}</strong>,
      }),
      columnHelper.accessor('status', {
        header: 'Estado',
        cell: (info) => <StatusBadge status={info.getValue()} />,
        filterFn: (row, _id, value: string) => {
          if (!value) {
            return true;
          }
          return row.original.status === value;
        },
      }),
      columnHelper.accessor((row) => row.presence ?? '', {
        id: 'presence',
        header: 'Presença',
        cell: (info) => <PresenceBadge presence={info.row.original.presence} />,
      }),
      columnHelper.accessor((row) => row.me?.pushName ?? '—', {
        id: 'pushName',
        header: 'Nome (push)',
      }),
      columnHelper.accessor((row) => shortJid(row.me?.jid), {
        id: 'jid',
        header: 'JID',
      }),
      columnHelper.accessor((row) => row.assignedWorker ?? '—', {
        id: 'worker',
        header: 'Worker',
      }),
      columnHelper.accessor((row) => row.apps?.length ?? 0, {
        id: 'apps',
        header: 'Apps',
        cell: (info) => {
          const n = info.getValue() as number;
          return n > 0 ? n : '—';
        },
      }),
      columnHelper.accessor((row) => row.timestamps?.activity ?? -1, {
        id: 'activity',
        header: 'Última atividade',
        cell: (info) => {
          const ms = info.getValue() as number;
          return ms < 0 ? '—' : formatActivity(ms);
        },
      }),
      columnHelper.display({
        id: 'metadata',
        header: 'Metadata',
        enableSorting: false,
        cell: ({ row }) => {
          const m = row.original.config?.metadata;
          if (!m || Object.keys(m).length === 0) {
            return <span className="cell-muted">—</span>;
          }
          return (
            <span className="cell-metadata" title={JSON.stringify(m)}>
              {Object.entries(m)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ')}
            </span>
          );
        },
      }),
    ],
    [],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, pagination, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn,
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const rows = table.getRowModel().rows;
  const statusFilter = (table.getColumn('status')?.getFilterValue() as
    | string
    | undefined) ?? '';

  return (
    <div className="sessions-table-wrap">
      <div className="sessions-toolbar">
        <label className="sessions-search">
          <span className="sessions-search-label">Filtrar</span>
          <input
            type="search"
            value={globalFilter ?? ''}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Nome, estado, JID, metadata…"
            className="sessions-search-input"
            autoComplete="off"
            aria-label="Filtro global na tabela"
          />
        </label>
        <div className="sessions-filters-row">
          <label className="sessions-filter-status">
            <span className="sessions-search-label">Estado</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                const v = e.target.value;
                table.getColumn('status')?.setFilterValue(v || undefined);
                table.setPageIndex(0);
              }}
              className="sessions-filter-select"
              aria-label="Filtrar por estado da sessão"
            >
              <option value="">Todos</option>
              {(statusValuesInData.length > 0
                ? statusValuesInData
                : [...SESSION_STATUS_OPTIONS]
              ).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="sessions-page-size">
            <span>Por página</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => {
                const n = Number(e.target.value);
                table.setPageSize(n);
                table.setPageIndex(0);
              }}
              aria-label="Linhas por página"
            >
              {[5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="sessions-table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th key={header.id}>
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="sessions-th-btn"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {{
                          asc: ' ▲',
                          desc: ' ▼',
                        }[header.column.getIsSorted() as string] ?? null}
                      </button>
                    ) : (
                      <span className="sessions-th-static">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="sessions-empty">
                  {data.length === 0
                    ? 'Sem sessões. Cria uma em POST /api/sessions ou activa “Incluir paradas”.'
                    : 'Nenhuma linha corresponde aos filtros.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="sessions-pagination">
        <span className="sessions-page-info">
          Página {table.getState().pagination.pageIndex + 1} de{' '}
          {table.getPageCount() || 1} · {filteredCount}{' '}
          {filteredCount === 1 ? 'sessão' : 'sessões'}
        </span>
        <div className="sessions-page-actions">
          <button
            type="button"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            aria-label="Primeira página"
          >
            ««
          </button>
          <button
            type="button"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Página anterior"
          >
            «
          </button>
          <button
            type="button"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Próxima página"
          >
            »
          </button>
          <button
            type="button"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
            aria-label="Última página"
          >
            »»
          </button>
        </div>
      </div>
    </div>
  );
}
