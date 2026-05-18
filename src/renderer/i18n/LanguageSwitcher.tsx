import React from 'react';
import { useLanguage } from './LanguageContext';
import './LanguageSwitcher.css';

function LanguageSwitcher(): React.JSX.Element {
  const { language, toggleLanguage, t } = useLanguage();
  const isItalian = language === 'it';
  const flag = isItalian ? '🇮🇹' : '🇬🇧';
  const aria = isItalian ? t('header.language.switchToEn') : t('header.language.switchTo');

  return (
    <button
      type="button"
      className="language-switcher"
      onClick={toggleLanguage}
      aria-label={aria}
      title={aria}
    >
      <span className="language-switcher-flag" aria-hidden="true">
        {flag}
      </span>
      <span className="language-switcher-code">{language.toUpperCase()}</span>
    </button>
  );
}

export { LanguageSwitcher };
