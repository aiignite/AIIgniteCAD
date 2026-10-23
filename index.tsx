import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { CanvasProvider } from './store/canvasStore';
import { AppProvider } from './store/appStore';
import { I18nProvider } from './lib/i18n';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <I18nProvider>
      <ErrorBoundary>
        <AppProvider>
          <CanvasProvider>
            <App />
          </CanvasProvider>
        </AppProvider>
      </ErrorBoundary>
    </I18nProvider>
  </React.StrictMode>
);