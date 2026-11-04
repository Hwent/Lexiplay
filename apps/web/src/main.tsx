import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installInteractionMetrics } from './services/interaction-metrics';
import './styles.css';
import './game-updates.css';
import './account.css';
import './design-tokens.css';
import './site.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element was not found');

installInteractionMetrics();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
