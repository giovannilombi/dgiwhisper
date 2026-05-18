import React from 'react';
import { useTranslation } from '../../../../i18n';
import './DonationSection.css';

const SUPPORT_EMAIL = 'giovanni.lombi@designgroupitalia.it';

function DonationSection(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="donation-container">
      <p className="footer-signature">
        {t('footer.signature')} <span aria-hidden="true">❤️</span>
      </p>
      <p className="footer-help">
        <a className="footer-help-link" href={`mailto:${SUPPORT_EMAIL}`}>
          {t('footer.help')}
        </a>
      </p>
      <p className="footer-credits">{t('footer.credits')}</p>
    </div>
  );
}

export { DonationSection };
