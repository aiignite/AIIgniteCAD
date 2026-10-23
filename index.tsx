import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { CanvasProvider } from './store/canvasStore';
import { AppProvider } from './store/appStore';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <CanvasProvider>
          <App />
        </CanvasProvider>
      </AppProvider>
    </ErrorBoundary>
  </React.StrictMode>
);