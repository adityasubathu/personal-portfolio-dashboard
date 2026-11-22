import { useQueryClient } from '@tanstack/react-query'
import { kiteKeys } from '@/api/kite'
import { openKiteLogin } from '@/lib/kiteLogin'
import { notify } from '@/lib/notify'

/** Opens Kite login in a self-closing tab and refreshes Kite status here once it reports back. */
export function useOpenKiteLogin() {
  const qc = useQueryClient()
  return function open(loginUrl: string) {
    openKiteLogin(loginUrl, () => {
      qc.invalidateQueries({ queryKey: kiteKeys.status })
      notify.success('Kite login successful.')
    })
  }
}
