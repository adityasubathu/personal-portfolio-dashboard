import { createContext, useContext, useState } from 'react'

interface PrivacyContextValue {
  privacyMode: boolean
  togglePrivacy: () => void
}

const PrivacyContext = createContext<PrivacyContextValue>({ privacyMode: false, togglePrivacy: () => {} })

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [privacyMode, setPrivacyMode] = useState(() => sessionStorage.getItem('privacyMode') === 'true')

  function togglePrivacy() {
    setPrivacyMode((prev) => {
      const next = !prev
      sessionStorage.setItem('privacyMode', String(next))
      return next
    })
  }

  return <PrivacyContext.Provider value={{ privacyMode, togglePrivacy }}>{children}</PrivacyContext.Provider>
}

export function usePrivacy() {
  return useContext(PrivacyContext)
}
