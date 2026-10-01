import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Font kendi sunucumuzdan sunulur: self-hosted kurulumlar internete kapalı ağda da çalışır.
import '@fontsource-variable/atkinson-hyperlegible-next';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
