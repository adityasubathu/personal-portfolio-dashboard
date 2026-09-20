import { useEffect, useRef, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from './Section'
import { cn } from '@/lib/utils'
import type { SseState } from '../hooks/useSse'

interface SsePanelProps<T> {
  sse: SseState<T>
  heading?: string
  doneHeading?: string
  errorHeading?: string
  className?: string
  onClose?: () => void
  resultRenderer?: (result: T) => ReactNode
}

export function SsePanel<T>({ sse, heading, doneHeading, errorHeading, className, onClose, resultRenderer }: SsePanelProps<T>) {
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [sse.logs])

  if (sse.status === 'idle') return null

  const isDone = sse.status === 'done' || sse.status === 'error'

  const resolvedHeading = sse.status === 'error'
    ? (errorHeading ?? heading ?? 'Done')
    : sse.status === 'done'
      ? (doneHeading ?? heading ?? 'Done')
      : (heading ?? 'Running…')

  return (
    <Section
      className={cn('mt-2', className)}
      title={
        <span className="flex items-center gap-2">
          {!isDone && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {resolvedHeading}
        </span>
      }
      action={
        isDone && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              sse.reset()
              onClose?.()
            }}
            aria-label="Close operation panel"
          >
            <X className="size-3.5" />
          </Button>
        )
      }
    >
      {sse.logs.length > 0 && (
        <pre
          ref={logRef}
          className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap break-words text-muted-foreground"
        >
          {sse.logs.join('\n')}
        </pre>
      )}

      {sse.status === 'error' && (
        <div className={cn('rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive', sse.logs.length > 0 && 'mt-2')}>
          <p className="font-semibold">Error</p>
          <p>{sse.error}</p>
        </div>
      )}

      {sse.status === 'done' && sse.result != null && resultRenderer && (
        <div className={sse.logs.length > 0 ? 'mt-2' : undefined}>{resultRenderer(sse.result)}</div>
      )}
    </Section>
  )
}
