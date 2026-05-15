import React from 'react';
import './DonationSection.css';

const SUPPORT_EMAIL = 'giovanni.lombi@designgroupitalia.it';

function DonationSection(): React.JSX.Element {
  return (
    <div className="donation-container">
      <p className="footer-signature">
        Design Group Italia – Team PM <span aria-hidden="true">❤️</span>
      </p>
      <p className="footer-help">
        <a className="footer-help-link" href={`mailto:${SUPPORT_EMAIL}`}>
          Bisogno di aiuto?
        </a>
      </p>
      <p className="footer-credits">Based on WhisperDesk · powered by whisper.cpp</p>
    </div>
  );
}

export { DonationSection };
