import React, { type ChangeEvent } from 'react';
import '../ModelSelector/ModelSelector.css';
import type { LanguageCode } from '../../../../types';
import { LANGUAGES } from '../../../../config';
import { useTranslation } from '../../../../i18n';

export interface LanguageSelectorProps {
  selectedLanguage: LanguageCode;
  disabled: boolean;
  onChange: (language: LanguageCode) => void;
}

function LanguageSelector({
  selectedLanguage,
  disabled,
  onChange,
}: LanguageSelectorProps): React.JSX.Element {
  const { t } = useTranslation();
  const handleChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    onChange(e.target.value as LanguageCode);
  };

  return (
    <div className="setting-group">
      <label htmlFor="language-select">{t('language.label')}</label>
      <select
        id="language-select"
        value={selectedLanguage}
        onChange={handleChange}
        disabled={disabled}
        aria-label={t('language.ariaLabel')}
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export { LanguageSelector };
