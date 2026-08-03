import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { fetchDashboardConfig } from './lib/api';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}
const mountNode: HTMLElement = rootElement;

async function bootstrap(): Promise<void> {
  const config = await fetchDashboardConfig();
  await Promise.all(
    config.stylesheets.map(
      (href) =>
        new Promise<void>((resolve, reject) => {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = href;
          link.onload = () => resolve();
          link.onerror = () => reject(new Error(`Failed to load stylesheet: ${href}`));
          document.head.appendChild(link);
        }),
    ),
  );

  createRoot(mountNode).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
