import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DonationSection } from '../DonationSection';

describe('DonationSection', () => {
  it('should render the credits line referencing WhisperDesk and whisper.cpp', () => {
    render(<DonationSection />);

    expect(screen.getByText(/Based on WhisperDesk/i)).toBeInTheDocument();
    expect(screen.getByText(/whisper\.cpp/i)).toBeInTheDocument();
  });

  it('should render a help mailto link pointing to the support email', () => {
    render(<DonationSection />);

    const helpLink = screen.getByRole('link', { name: /need help\?/i });
    expect(helpLink).toBeInTheDocument();
    expect(helpLink).toHaveAttribute('href', 'mailto:giovanni.lombi@designgroupitalia.it');
  });

  it('should render the Design Group Italia signature with a heart', () => {
    render(<DonationSection />);

    const signature = screen.getByText(/Design Group Italia – Team PM/i);
    expect(signature).toBeInTheDocument();
    expect(signature.textContent).toContain('❤️');
  });
});
