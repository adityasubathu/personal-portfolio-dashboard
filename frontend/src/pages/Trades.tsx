import { useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useTrades } from '../api/trades'
import { MoneyText } from '../components/MoneyText'
import { usePrivacy } from '../hooks/usePrivacy'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { inr } from '../lib/format'
import { apiUrl } from '../api/client'
import type { TradeOrderRow, TradeRow } from '../types/trades'
import { PageHeader } from '../components/PageHeader'
import { Section } from '@/components/Section'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CHIP_CLASS } from '@/lib/colors'

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function QtyText({ value }: { value: number }) {
  const { privacyMode } = usePrivacy()
  return <>{privacyMode ? '•••' : value}</>
}

function TradeTypeBadge({ type }: { type: string }) {
  return (
    <Badge className={type === 'BUY' ? CHIP_CLASS.green : CHIP_CLASS.red} variant="outline">
      {type}
    </Badge>
  )
}

function OrderDetailRow({ trade }: { trade: TradeRow }) {
  return (
    <tr className="bg-muted/40">
      <td />
      <td className="px-2 py-1.5">{trade.trade_date}</td>
      <td className="px-2 py-1.5"><TradeTypeBadge type={trade.trade_type} /></td>
      <td className="px-2 py-1.5 text-xs">{trade.symbol ?? '—'}</td>
      <td className="px-2 py-1.5 text-xs text-muted-foreground">{trade.isin ?? '—'}</td>
      <td data-numeric className="px-2 py-1.5 text-right"><QtyText value={trade.quantity} /></td>
      <td data-numeric className="px-2 py-1.5 text-right">{inr(trade.price)}</td>
      <td data-numeric className="px-2 py-1.5 text-right"><MoneyText value={trade.amount ?? trade.price * trade.quantity} /></td>
      <td className="px-2 py-1.5">{trade.exchange ?? '—'}</td>
      <td className="px-2 py-1.5 text-xs text-muted-foreground">{trade.source}</td>
      <td className="px-2 py-1.5 text-xs text-muted-foreground">{trade.notes ?? ''}</td>
    </tr>
  )
}

function OrderRow({ order, expanded, onToggle }: { order: TradeOrderRow; expanded: boolean; onToggle: () => void }) {
  const hasMultiple = order.trades.length > 1

  return (
    <>
      <tr className={cn('hover:bg-muted/50', hasMultiple && 'cursor-pointer')} onClick={hasMultiple ? onToggle : undefined}>
        <td className="px-2 py-1.5">
          {hasMultiple && (
            <button type="button" onClick={onToggle} className="flex">
              {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          )}
        </td>
        <td className="px-2 py-1.5">{order.trade_date}</td>
        <td className="px-2 py-1.5"><TradeTypeBadge type={order.trade_type} /></td>
        <td className="px-2 py-1.5 text-xs font-medium">{order.symbol ?? '—'}</td>
        <td className="px-2 py-1.5 text-xs text-muted-foreground">{order.isin ?? '—'}</td>
        <td data-numeric className="px-2 py-1.5 text-right"><QtyText value={order.quantity} /></td>
        <td data-numeric className="px-2 py-1.5 text-right">{inr(order.price)}</td>
        <td data-numeric className="px-2 py-1.5 text-right"><MoneyText value={order.amount} /></td>
        <td className="px-2 py-1.5">{order.exchange ?? '—'}</td>
        <td className="px-2 py-1.5 text-xs text-muted-foreground">{order.source}</td>
        <td className="px-2 py-1.5 text-xs text-muted-foreground">
          {hasMultiple && `${order.trades.length} trades`}
        </td>
      </tr>
      {hasMultiple && expanded && order.trades.map((t) => <OrderDetailRow key={t.id} trade={t} />)}
    </>
  )
}

function MobileOrderCard({ order }: { order: TradeOrderRow }) {
  return (
    <div className="p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{order.symbol ?? '—'}</span>
        <TradeTypeBadge type={order.trade_type} />
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{order.trade_date}</span>
        <span data-numeric>
          <QtyText value={order.quantity} /> @ {inr(order.price)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{order.exchange ?? '—'}</span>
        <MoneyText value={order.amount} className="font-medium" />
      </div>
    </div>
  )
}

export function Trades() {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebouncedValue(q, 300)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const isMobile = useMediaQuery('(max-width: 767px)')

  const { data, isLoading } = useTrades(page, debounced)

  function handleSearch(val: string) {
    setQ(val)
    setPage(1)
  }

  function toggleExpanded(orderId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Trades"
        actions={
          <a href={apiUrl('/api/v1/trades/template')} download className="text-xs text-primary underline-offset-4 hover:underline">
            Download CSV template
          </a>
        }
      />

      <Section
        bodyClassName="p-0"
        title={
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search symbol or ISIN…"
                value={q}
                onChange={(e) => handleSearch(e.target.value)}
                className="h-8 w-64 pl-7 text-xs"
              />
            </div>
            {data && <span className="text-xs text-muted-foreground">{data.total} orders</span>}
          </div>
        }
      >
        {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}

        {data && !isMobile && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 1050 }}>
              <thead>
                <tr className="sticky top-0 z-10 bg-card">
                  <th className="h-8 px-2" />
                  <th className="h-8 px-2 text-left font-medium text-muted-foreground">Date</th>
                  <th className="h-8 px-2 text-left font-medium text-muted-foreground">Type</th>
                  <th className="h-8 px-2 text-left font-medium text-muted-foreground">Symbol</th>
                  <th className="h-8 px-2 text-left font-medium text-muted-foreground">ISIN</th>
                  <th className="h-8 px-2 text-right font-medium text-muted-foreground">Qty</th>
                  <th className="h-8 px-2 text-right font-medium text-muted-foreground">Price</th>
                  <th className="h-8 px-2 text-right font-medium text-muted-foreground">Amount</th>
                  <th className="h-8 px-2 text-left font-medium text-muted-foreground">Exchange</th>
                  <th className="h-8 px-2 text-left font-medium text-muted-foreground">Source</th>
                  <th className="h-8 px-2 text-left font-medium text-muted-foreground">Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((order) => (
                  <OrderRow
                    key={order.order_id}
                    order={order}
                    expanded={expandedIds.has(order.order_id)}
                    onToggle={() => toggleExpanded(order.order_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && isMobile && <div className="divide-y">{data.rows.map((order) => <MobileOrderCard key={order.order_id} order={order} />)}</div>}

        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-2">
            <Button variant="outline" size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="size-3.5" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {data.total_pages}
            </span>
            <Button variant="outline" size="xs" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>
              Next
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}
      </Section>
    </div>
  )
}
