import React, { useRef, useEffect, type ChangeEvent } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { useTranslation } from '../../../../i18n';
import './TranscriptionSearch.css';

export interface TranscriptionSearchProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  currentMatchIndex: number;
  totalMatches: number;
  onPrevMatch: () => void;
  onNextMatch: () => void;
  onClose: () => void;
}

function TranscriptionSearch({
  searchQuery,
  onSearchChange,
  currentMatchIndex,
  totalMatches,
  onPrevMatch,
  onNextMatch,
  onClose,
}: TranscriptionSearchProps): React.JSX.Element {
  const { t } = useTranslation();
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>): void => {
    onSearchChange(e.target.value);
  };

  return (
    <div className="search-bar">
      <input
        ref={searchInputRef}
        type="text"
        className="search-input"
        placeholder={t('search.placeholder')}
        value={searchQuery}
        onChange={handleSearchChange}
        aria-label={t('search.inputAria')}
      />
      <div className="search-nav">
        {searchQuery && (
          <span className="search-count">
            {totalMatches > 0
              ? t('search.matchCount', { current: currentMatchIndex + 1, total: totalMatches })
              : t('search.noMatches')}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronUp size={14} />}
          iconOnly
          onClick={onPrevMatch}
          disabled={totalMatches === 0}
          title={t('search.prevTitle')}
          aria-label={t('search.prev')}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronDown size={14} />}
          iconOnly
          onClick={onNextMatch}
          disabled={totalMatches === 0}
          title={t('search.nextTitle')}
          aria-label={t('search.next')}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={<X size={14} />}
          iconOnly
          onClick={onClose}
          title={t('search.closeTitle')}
          aria-label={t('search.close')}
        />
      </div>
    </div>
  );
}

export { TranscriptionSearch };
