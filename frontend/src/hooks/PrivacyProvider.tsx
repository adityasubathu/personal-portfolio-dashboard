import { useState, type ReactNode } from 'react'
import { PrivacyContext } from './usePrivacy'

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [privacyMode, setPrivacyMode] = useState(() => sessionStorage.getItem('privacyMode') === 'true')
  function togglePrivacy() { setPrivacyMode((prev) => { const next = !prev; sessionStorage.setItem('privacyMode', String(next)); return next }) }
  return <PrivacyContext.Provider value={{ privacyMode, togglePrivacy }}>{children}</PrivacyContext.Provider>
}
