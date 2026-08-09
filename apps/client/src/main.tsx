import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import './design-system/fonts.css';
import './design-system/tokens.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root missing from index.html');

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

