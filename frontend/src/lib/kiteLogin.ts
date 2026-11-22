const CHANNEL = 'kite-login'
const HANDBACK_TIMEOUT_MS = 500

type KiteLoginMessage = { type: 'logged-in' } | { type: 'close' }

let waiting: BroadcastChannel | null = null

/** Opens Kite login in a new tab; when that tab lands back on /kite it is told to close and `onLoggedIn` runs here. */
export function openKiteLogin(loginUrl: string, onLoggedIn: () => void) {
  waiting?.close()
  const channel = new BroadcastChannel(CHANNEL)
  waiting = channel
  channel.onmessage = (e: MessageEvent<KiteLoginMessage>) => {
    if (e.data.type !== 'logged-in') return
    channel.postMessage({ type: 'close' } satisfies KiteLoginMessage)
    channel.close()
    if (waiting === channel) waiting = null
    onLoggedIn()
  }
  window.open(loginUrl, '_blank')
}

/** Called by the tab Kite redirected back to; resolves true when the tab that opened the login has claimed it. */
export function handBackKiteLogin(): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(CHANNEL)
    const finish = (claimed: boolean) => {
      clearTimeout(timer)
      channel.close()
      resolve(claimed)
    }
    const timer = setTimeout(() => finish(false), HANDBACK_TIMEOUT_MS)
    channel.onmessage = (e: MessageEvent<KiteLoginMessage>) => {
      if (e.data.type === 'close') finish(true)
    }
    channel.postMessage({ type: 'logged-in' } satisfies KiteLoginMessage)
  })
}
