import React from 'react';
import { AppProvider } from './contexts';
import { AppHeader, LeftPanel, RightPanel } from './components';
import { ErrorBoundary } from './components/ui';
import { UpdateNotification } from './features/auto-update';
import { LanguageProvider } from './i18n';
import './App.css';

function App(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AppProvider>
          <div className="app">
            <AppHeader />

            <main className="app-main">
              <LeftPanel />
              <RightPanel />
            </main>

            <UpdateNotification />
          </div>
        </AppProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}

export { App };
