import '@react-starter/ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StarterRoot } from './app/StarterRoot';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <StarterRoot />
  </StrictMode>,
);
