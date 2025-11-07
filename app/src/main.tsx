import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthWrapper from './AuthWrapper.tsx'
import './index.css'
import { useDarkMode } from './hooks/useDarkMode.ts'
import { AuthProvider } from './contexts/AuthContext.tsx'
import { AuthStateManagerProvider } from './contexts/AuthStateManager.tsx'
import { SubscriptionProvider } from './contexts/SubscriptionContext.tsx'

function Root() {
  const { darkMode, setDarkMode } = useDarkMode();

  return (
    <AuthStateManagerProvider>
      <AuthProvider>
        <SubscriptionProvider>
          <AuthWrapper darkMode={darkMode} setDarkMode={setDarkMode} />
        </SubscriptionProvider>
      </AuthProvider>
    </AuthStateManagerProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />) 