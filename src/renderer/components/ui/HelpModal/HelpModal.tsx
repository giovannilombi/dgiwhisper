import React, { useCallback, useEffect } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { Button } from '../Button';
import { useTranslation } from '../../../i18n';
import './HelpModal.css';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ModelRow {
  name: string;
  size: string;
  speed: string;
  quality: string;
  bestForKey:
    | 'help.models.bestFor.tiny'
    | 'help.models.bestFor.base'
    | 'help.models.bestFor.small'
    | 'help.models.bestFor.medium'
    | 'help.models.bestFor.large'
    | 'help.models.bestFor.turbo';
}

const MODEL_ROWS: ModelRow[] = [
  {
    name: 'tiny',
    size: '75 MB',
    speed: '~10×',
    quality: '★☆☆☆☆',
    bestForKey: 'help.models.bestFor.tiny',
  },
  {
    name: 'base',
    size: '142 MB',
    speed: '~7×',
    quality: '★★☆☆☆',
    bestForKey: 'help.models.bestFor.base',
  },
  {
    name: 'small',
    size: '466 MB',
    speed: '~4×',
    quality: '★★★☆☆',
    bestForKey: 'help.models.bestFor.small',
  },
  {
    name: 'medium',
    size: '1.5 GB',
    speed: '~2×',
    quality: '★★★★☆',
    bestForKey: 'help.models.bestFor.medium',
  },
  {
    name: 'large-v3',
    size: '3.1 GB',
    speed: '~1×',
    quality: '★★★★★',
    bestForKey: 'help.models.bestFor.large',
  },
  {
    name: 'large-v3-turbo',
    size: '1.6 GB',
    speed: '~2×',
    quality: '★★★★★',
    bestForKey: 'help.models.bestFor.turbo',
  },
];

function HelpModal({ isOpen, onClose }: HelpModalProps): React.JSX.Element | null {
  const { t } = useTranslation();

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="help-modal-overlay" onClick={handleOverlayClick}>
      <div
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
      >
        <div className="help-modal-header">
          <h2 id="help-modal-title">
            <HelpCircle size={18} aria-hidden="true" />
            {t('help.title')}
          </h2>
          <Button
            variant="ghost"
            icon={<X size={20} />}
            iconOnly
            onClick={onClose}
            aria-label={t('help.close')}
            className="help-modal-close"
          />
        </div>

        <div className="help-modal-content">
          <section className="help-section">
            <h3>{t('help.usage.heading')}</h3>

            <div className="help-step">
              <h4>{t('help.usage.step1.title')}</h4>
              <ul>
                <li>{t('help.usage.step1.b1')}</li>
                <li>{t('help.usage.step1.b2')}</li>
                <li>{t('help.usage.step1.b3')}</li>
              </ul>
            </div>

            <div className="help-step">
              <h4>{t('help.usage.step2.title')}</h4>
              <dl>
                <dt>{t('help.usage.step2.diarization.title')}</dt>
                <dd>{t('help.usage.step2.diarization.body')}</dd>
                <dt>{t('help.usage.step2.model.title')}</dt>
                <dd>{t('help.usage.step2.model.body')}</dd>
                <dt>{t('help.usage.step2.audioLang.title')}</dt>
                <dd>{t('help.usage.step2.audioLang.body')}</dd>
                <dt>{t('help.usage.step2.uiLang.title')}</dt>
                <dd>{t('help.usage.step2.uiLang.body')}</dd>
              </dl>
            </div>

            <div className="help-step">
              <h4>{t('help.usage.step3.title')}</h4>
              <p>{t('help.usage.step3.body')}</p>
            </div>

            <div className="help-step">
              <h4>{t('help.usage.step4.title')}</h4>
              <p>{t('help.usage.step4.basic')}</p>
              <p>{t('help.usage.step4.diarized')}</p>
              <dl>
                <dt>{t('help.usage.step4.rename.title')}</dt>
                <dd>{t('help.usage.step4.rename.body')}</dd>
                <dt>{t('help.usage.step4.merge.title')}</dt>
                <dd>{t('help.usage.step4.merge.body')}</dd>
                <dt>{t('help.usage.step4.split.title')}</dt>
                <dd>{t('help.usage.step4.split.body')}</dd>
              </dl>
              <p className="help-callout">{t('help.usage.step4.persist')}</p>
            </div>

            <div className="help-step">
              <h4>{t('help.usage.step5.title')}</h4>
              <p>{t('help.usage.step5.intro')}</p>
              <ul>
                <li>{t('help.usage.step5.txtMd')}</li>
                <li>{t('help.usage.step5.vttSrt')}</li>
                <li>{t('help.usage.step5.docxPdf')}</li>
              </ul>
              <p>{t('help.usage.step5.copy')}</p>
            </div>

            <div className="help-step">
              <h4>{t('help.usage.step6.title')}</h4>
              <p>{t('help.usage.step6.body')}</p>
            </div>
          </section>

          <section className="help-section">
            <h3>{t('help.models.heading')}</h3>
            <p>{t('help.models.intro')}</p>
            <div className="help-models-table-wrapper">
              <table className="help-models-table">
                <thead>
                  <tr>
                    <th>{t('help.models.col.model')}</th>
                    <th>{t('help.models.col.size')}</th>
                    <th>{t('help.models.col.speed')}</th>
                    <th>{t('help.models.col.quality')}</th>
                    <th>{t('help.models.col.bestFor')}</th>
                  </tr>
                </thead>
                <tbody>
                  {MODEL_ROWS.map((row) => (
                    <tr key={row.name}>
                      <td>
                        <code>{row.name}</code>
                      </td>
                      <td>{row.size}</td>
                      <td>{row.speed}</td>
                      <td className="help-models-quality">{row.quality}</td>
                      <td>{t(row.bestForKey)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="help-models-note">{t('help.models.englishOnly')}</p>
            <p className="help-models-note">{t('help.models.download')}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

export { HelpModal };
export type { HelpModalProps };
