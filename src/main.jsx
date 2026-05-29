import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { CoachProvider } from './context/CoachContext.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <CoachProvider>
        <App />
      </CoachProvider>
    </AuthProvider>
  </React.StrictMode>,
)
// PWA: register minimal SW (cache-bust only, no fetch interception)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => reg.update()).catch(() => {});
  });
}
