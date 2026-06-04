import { useState, useCallback, useRef } from 'react'

export type SseStatus = 'idle' | 'running' | 'done' | 'error'

export interface SseState<T = unknown> {
  logs: string[]
  status: SseStatus
  result: T | null
  error: string | null
  start: () => void
  reset: () => void
}

export function useSse<T = unknown>(url: string): SseState<T> {
  const [logs, setLogs] = useState<string[]>([])
  const [status, setStatus] = useState<SseStatus>('idle')
  const [result, setResult] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const reset = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    setLogs([])
    setStatus('idle')
    setResult(null)
    setError(null)
  }, [])

  const start = useCallback(() => {
    esRef.current?.close()
    setLogs([])
    setStatus('running')
    setResult(null)
    setError(null)

    const es = new EventSource(url)
    esRef.current = es

    es.addEventListener('log', (e) => {
      setLogs((prev) => [...prev, (e as MessageEvent).data])
    })

    es.addEventListener('done', (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data)
        if (payload.ok) {
          setResult(payload.result ?? payload)
          setStatus('done')
        } else {
          setError(payload.error ?? 'Unknown error')
          setStatus('error')
        }
      } catch {
        setError('Failed to parse response')
        setStatus('error')
      }
      es.close()
      esRef.current = null
    })

    es.onerror = () => {
      setError('Connection error')
      setStatus('error')
      es.close()
      esRef.current = null
    }
  }, [url])

  return { logs, status, result, error, start, reset }
}
