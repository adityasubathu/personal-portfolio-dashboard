import { createContext, useContext } from 'react'

export interface PrivacyContextValue {
  privacyMode: boolean
  togglePrivacy: () => void
}

export const PrivacyContext = createContext<PrivacyContextValue>({ privacyMode: false, togglePrivacy: () => {} })

export function usePrivacy() {
  return useContext(PrivacyContext)
}
