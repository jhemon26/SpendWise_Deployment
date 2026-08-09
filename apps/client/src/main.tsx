import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import './design-system/fonts.css';
import './design-system/tokens.css';
import { useApp, applyTheme } from './core/store.js';

const el = document.getElementById('root');
if (!el) throw new Error('#root missing from index.html');

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Keeps the attribute in step with the persisted value on a cold start.
applyTheme(useApp.getState().theme);
