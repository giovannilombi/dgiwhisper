import React from 'react';
import { Moon, Sun, History, Terminal } from 'lucide-react';
import { Button } from '../../ui';
import { useAppTheme, useAppHistory } from '../../../contexts';
import { useDebugLogs } from '../../../hooks';
import { DebugLogsModal } from '../../ui/DebugLogsModal';
import { LanguageSwitcher, useTranslation } from '../../../i18n';
import appIcon from '../../../assets/icon.png';

function AppHeader(): React.JSX.Element {
  const { theme, toggleTheme } = useAppTheme();
  const { history, toggleHistory } = useAppHistory();
  const { t } = useTranslation();
  const {
    logs,
    isOpen: isDebugLogsOpen,
    openModal: openDebugLogs,
    closeModal: closeDebugLogs,
    copyLogs,
    copyLogsWithSystemInfo,
    clearLogs,
  } = useDebugLogs();

  const themeAria = theme === 'light' ? t('header.themeDark') : t('header.themeLight');

  return (
    <>
      <header className="app-header">
        <div className="header-content">
          <div className="header-left">
            <img src={appIcon} alt="DGI-Whisper" className="app-logo" />
            <div className="header-title">
              <h1>DGI-Whisper</h1>
              <p>{t('header.claim')}</p>
            </div>
          </div>
          <div className="header-actions">
            <Button
              variant="icon"
              icon={<Terminal size={18} />}
              iconOnly
              onClick={openDebugLogs}
              title={t('header.debugLogs')}
              aria-label={t('header.openDebugLogs')}
            />
            <Button
              variant="icon"
              icon={theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
              iconOnly
              onClick={toggleTheme}
              title={themeAria}
              aria-label={themeAria}
              className="theme-toggle"
            />
            <Button
              variant="icon"
              icon={<History size={18} />}
              onClick={toggleHistory}
              title={t('header.history', { count: history.length })}
              aria-label={t('header.history', { count: history.length })}
            >
              {t('header.history', { count: history.length })}
            </Button>
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <DebugLogsModal
        isOpen={isDebugLogsOpen}
        logs={logs}
        onClose={closeDebugLogs}
        onCopyLogs={copyLogs}
        onCopyLogsWithSystemInfo={copyLogsWithSystemInfo}
        onClearLogs={clearLogs}
      />
    </>
  );
}

export { AppHeader };
