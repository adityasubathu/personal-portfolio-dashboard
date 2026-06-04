import React, { useState } from 'react'
import { Table, Text, UnstyledButton, Group } from '@mantine/core'
import { IconChevronUp, IconChevronDown, IconSelector } from '@tabler/icons-react'
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
}

function SortIcon({ dir }: { dir: 'asc' | 'desc' | null }) {
  if (dir === 'asc') return <IconChevronUp size={13} />
  if (dir === 'desc') return <IconChevronDown size={13} />
  return <IconSelector size={13} style={{ opacity: 0.4 }} />
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
    <Table.Tr>
      {columns.map((col) => (
        <Table.Th
          key={col.key}
          style={{ textAlign: col.align ?? 'left', whiteSpace: 'nowrap' }}
        >
          {col.sortable ? (
            <UnstyledButton onClick={() => handleSort(col.key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <Text size="xs" fw={600}>{col.label}</Text>
              <SortIcon dir={sort === col.key ? dir : null} />
            </UnstyledButton>
          ) : (
            <Text size="xs" fw={600}>{col.label}</Text>
          )}
        </Table.Th>
      ))}
    </Table.Tr>
  )

  function renderRow(row: T, i: number) {
    return (
      <Table.Tr key={rowKey(row)} style={striped && i % 2 === 1 ? { background: 'var(--mantine-color-gray-1)' } : {}}>
        {columns.map((col) => {
          const heat = col.heatmap?.(row)
          const bg = heat ? heatmapBg(heat.value, heat.min, heat.max) : undefined
          return (
            <Table.Td
              key={col.key}
              style={{ textAlign: col.align ?? 'left', background: bg, whiteSpace: 'nowrap' }}
            >
              {col.render(row)}
            </Table.Td>
          )
        })}
      </Table.Tr>
    )
  }

  const allRows = rows ?? sections?.flatMap((s) => s.rows) ?? []
  const flatSorted = sortRows(allRows)

  return (
    <Table fz="xs" withColumnBorders={false} highlightOnHover>
      <Table.Thead>{headerRow}</Table.Thead>
      <Table.Tbody>
        {sections && !sort
          ? sections.map((sec) => (
              <React.Fragment key={sec.label ?? '__ungrouped'}>
                {sec.label && (
                  <Table.Tr>
                    <Table.Td
                      colSpan={columns.length}
                      style={{
                        background: 'var(--mantine-color-gray-1)',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        padding: '4px 8px',
                      }}
                    >
                      {sec.label}
                    </Table.Td>
                  </Table.Tr>
                )}
                {sec.rows.map((row, i) => renderRow(row, i))}
              </React.Fragment>
            ))
          : flatSorted.map((row, i) => renderRow(row, i))}
      </Table.Tbody>
      {footer && <Table.Tfoot>{footer}</Table.Tfoot>}
    </Table>
  )
}
