import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PublicAccess from './PublicAccess';
import './styles.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PublicAccess>
      <App />
    </PublicAccess>
  </React.StrictMode>,
);
