import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main className="welcome">
      <p className="eyebrow">A little practice, every day</p>
      <h1>Make words stick.</h1>
      <p className="intro">LexiPlay is getting ready. Your vocabulary practice starts here soon.</p>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element was not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
