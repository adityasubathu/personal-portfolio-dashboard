import React, { useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { heatmapBg } from '../lib/format'

export interface Column<T> {
  key: string
  label: string
  sortable?: boolean
  align?: 'left' | 'right' | 'center'
  render: (row: T) => React.ReactNode
  heatmap?: (row: T) => { value: number | null; min: number | null; max: number | null }
}

export interface SectionGroup<T> {
  label: string | null
  rows: T[]
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows?: T[]
  sections?: SectionGroup<T>[]
  defaultSort?: string
  defaultDir?: 'asc' | 'desc'
  rowKey: (row: T) => string | number
  footer?: React.ReactNode
  striped?: boolean
  minWidth?: number | string
  stickyHeader?: boolean
  stickyFirstColumn?: boolean
  emptyMessage?: string
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const

function SortIcon({ dir }: { dir: 'asc' | 'desc' | null }) {
  if (dir === 'asc') return <ChevronUp className="size-3.5" />
  if (dir === 'desc') return <ChevronDown className="size-3.5" />
  return <ChevronsUpDown className="size-3.5 opacity-40" />
}

export function DataTable<T>({
  columns,
  rows,
  sections,
  defaultSort,
  defaultDir = 'asc',
  rowKey,
  footer,
  striped,
  minWidth = 'max-content',
  stickyHeader = true,
  stickyFirstColumn = false,
  emptyMessage = 'No data available.',
}: DataTableProps<T>) {
  const [sort, setSort] = useState(defaultSort ?? '')
  const [dir, setDir] = useState<'asc' | 'desc'>(defaultDir)

  function handleSort(key: string) {
    if (sort === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(key)
      setDir('asc')
    }
  }

  function sortRows(input: T[]): T[] {
    if (!sort) return input
    const col = columns.find((c) => c.key === sort)
    if (!col) return input
    return [...input].sort((a, b) => {
      const av = col.render(a)
      const bv = col.render(b)
      const an = typeof av === 'number' ? av : String(av ?? '')
      const bn = typeof bv === 'number' ? bv : String(bv ?? '')
      if (typeof an === 'number' && typeof bn === 'number') {
        return dir === 'asc' ? an - bn : bn - an
      }
      return dir === 'asc'
        ? String(an).localeCompare(String(bn))
        : String(bn).localeCompare(String(an))
    })
  }

  const headerRow = (
    <tr>
      {columns.map((col, i) => (
        <th
          key={col.key}
          className={cn(
            'h-8 px-2 font-medium text-muted-foreground whitespace-nowrap',
            alignClass[col.align ?? 'left'],
            stickyHeader && 'sticky top-0 z-10 bg-card',
            stickyFirstColumn && i === 0 && 'sticky left-0 z-20 bg-card',
          )}
        >
          {col.sortable ? (
            <button
              type="button"
              onClick={() => handleSort(col.key)}
              aria-sort={sort === col.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              className="inline-flex items-center gap-1"
            >
              <span className="text-xs font-semibold">{col.label}</span>
              <SortIcon dir={sort === col.key ? dir : null} />
            </button>
          ) : (
            <span className="text-xs font-semibold">{col.label}</span>
          )}
        </th>
      ))}
    </tr>
  )

  function renderRow(row: T, i: number) {
    return (
      <tr key={rowKey(row)} className={cn('hover:bg-muted/50', striped && i % 2 === 1 && 'bg-muted/30')}>
        {columns.map((col, colIndex) => {
          const heat = col.heatmap?.(row)
          const bg = heat ? heatmapBg(heat.value, heat.min, heat.max) : undefined
          const sticky = stickyFirstColumn && colIndex === 0
          return (
            <td
              key={col.key}
              data-numeric={col.align === 'right' || undefined}
              className={cn(
                'px-2 py-1.5 whitespace-nowrap',
                alignClass[col.align ?? 'left'],
                sticky && 'sticky left-0 z-10',
              )}
              style={{ background: bg ?? (sticky ? 'var(--card)' : undefined) }}
            >
              {col.render(row)}
            </td>
          )
        })}
      </tr>
    )
  }

  const allRows = rows ?? sections?.flatMap((s) => s.rows) ?? []
  const flatSorted = sortRows(allRows)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" style={{ minWidth }}>
        <thead>{headerRow}</thead>
        <tbody>
          {sections && !sort
            ? sections.map((sec) => (
                <React.Fragment key={sec.label ?? '__ungrouped'}>
                  {sec.label && (
                    <tr>
                      <td colSpan={columns.length} className="bg-muted px-2 py-1 text-[11px] font-semibold">
                        {sec.label}
                      </td>
                    </tr>
                  )}
                  {sec.rows.map((row, i) => renderRow(row, i))}
                </React.Fragment>
              ))
            : flatSorted.length
              ? flatSorted.map((row, i) => renderRow(row, i))
              : (
                  <tr>
                    <td colSpan={columns.length} className="py-4 text-center text-muted-foreground">
                      {emptyMessage}
                    </td>
                  </tr>
                )}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  )
}
