const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export function apiUrl(path: string): string {
  return `${BASE}${path}`
}

async function toJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  return toJson<T>(res)
}

export async function requestForm<T>(path: string, body: FormData | URLSearchParams, method = 'POST'): Promise<T> {
  const res = await fetch(apiUrl(path), { method, body })
  return toJson<T>(res)
}
