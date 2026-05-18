import React, {
  useMemo,
  useState,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { History, Trash2, X, Inbox, Clock, Search } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { formatDate, formatDuration } from '../../../../utils';
import { getLanguageLabel } from '../../../../config';
import { useTranslation } from '../../../../i18n';
import './TranscriptionHistory.css';

import type { HistoryItem } from '../../../../types';

export interface TranscriptionHistoryProps {
  history: HistoryItem[];
  onClear: () => void;
  onClose: () => void;
  onSelect: (item: HistoryItem) => void;
  onDelete: (itemId: string) => void;
}

function TranscriptionHistory({
  history,
  onClear,
  onClose,
  onSelect,
  onDelete,
}: TranscriptionHistoryProps): React.JSX.Element {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredHistory = useMemo(() => {
    if (!trimmedQuery) {
      return history;
    }

    return history.filter((item) => {
      const searchable = [
        item.fileName,
        item.preview,
        item.fullText,
        item.model,
        getLanguageLabel(item.language),
        item.format ?? '',
      ]
        .join(' ')
        .toLowerCase();

      return searchable.includes(trimmedQuery);
    });
  }, [history, trimmedQuery]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleItemKeyDown = (e: KeyboardEvent<HTMLDivElement>, item: HistoryItem): void => {
    if (e.key === 'Enter') {
      onSelect(item);
    }
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setSearchQuery(event.target.value);
  };

  const handleSearchClear = (): void => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  };

  const handleDelete = (event: React.MouseEvent, itemId: string, fileName: string): void => {
    event.stopPropagation();
    if (window.confirm(t('history.deleteConfirm', { name: fileName }))) {
      onDelete(itemId);
    }
  };

  const handleClearAll = (): void => {
    if (window.confirm(t('history.clearConfirm'))) {
      onClear();
    }
  };

  return (
    <div className="history-container">
      <div className="history-header">
        <h3>
          <History size={20} aria-hidden="true" /> {t('history.title')}
        </h3>
        <div className="history-actions">
          {history.length > 0 && (
            <Button
              variant="icon"
              icon={<Trash2 size={16} />}
              onClick={handleClearAll}
              className="danger"
            >
              {t('history.clear')}
            </Button>
          )}
          <Button variant="icon" icon={<X size={16} />} onClick={onClose}>
            {t('history.close')}
          </Button>
        </div>
      </div>

      <div className="history-content">
        {history.length === 0 ? (
          <div className="history-empty">
            <span className="empty-icon">
              <Inbox size={48} aria-hidden="true" />
            </span>
            <span>{t('history.empty.title')}</span>
            <span className="empty-hint">{t('history.empty.body')}</span>
          </div>
        ) : (
          <>
            <div className="history-search">
              <Search size={16} aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="text"
                className="history-search-input"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder={t('history.search.placeholder')}
                aria-label={t('history.search.aria')}
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<X size={14} />}
                  iconOnly
                  onClick={handleSearchClear}
                  title={t('history.search.clearTitle')}
                  aria-label={t('history.search.clearAria')}
                />
              )}
            </div>

            {trimmedQuery && (
              <div className="history-search-summary">
                {t(
                  filteredHistory.length === 1
                    ? 'history.search.resultsOne'
                    : 'history.search.resultsMany',
                  { count: filteredHistory.length }
                )}
              </div>
            )}

            {filteredHistory.length === 0 ? (
              <div className="history-empty history-empty-search">
                <span>{t('history.search.noMatches.title')}</span>
                <span className="empty-hint">{t('history.search.noMatches.body')}</span>
              </div>
            ) : (
              <div className="history-list">
                {filteredHistory.map((item) => (
                  <div
                    key={item.id}
                    className="history-item"
                    onClick={() => onSelect(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => handleItemKeyDown(e, item)}
                  >
                    <div className="history-item-header">
                      <span className="history-filename">{item.fileName}</span>
                      <div className="history-item-header-actions">
                        <span className="history-date">{formatDate(item.date)}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 size={14} />}
                          iconOnly
                          onClick={(event) => handleDelete(event, item.id, item.fileName)}
                          title={t('history.delete')}
                          aria-label={t('history.deleteAria', { name: item.fileName })}
                          className="history-item-delete"
                        />
                      </div>
                    </div>
                    <div className="history-item-meta">
                      <span className="history-tag">{item.model}</span>
                      <span className="history-tag">{getLanguageLabel(item.language)}</span>
                      {item.format && <span className="history-tag">.{item.format}</span>}
                      <span className="history-duration">
                        <Clock size={12} aria-hidden="true" /> {formatDuration(item.duration)}
                      </span>
                    </div>
                    <p className="history-preview">{item.preview}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export { TranscriptionHistory };
