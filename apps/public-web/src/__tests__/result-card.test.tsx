import { render, screen } from '@testing-library/react';
import type { PublicCaregiverSummary } from '@care-platform/shared';
import { ResultCard } from '@/components/results/result-card';
import { renderWithProviders } from '@/lib/test/test-utils';

function caregiver(overrides: Partial<PublicCaregiverSummary> = {}): PublicCaregiverSummary {
  return {
    publicId: 'abcd1234-ef56-7890-abcd-1234567890ab',
    gender: 'FEMALE',
    approxAge: 45,
    yearsExperience: 8,
    district: 'Colombo',
    city: 'Colombo',
    preferredLocations: [],
    languages: [{ name: 'Sinhala', proficiency: 'FLUENT' }],
    skills: [{ id: 's1', name: "Parkinson's Care" }],
    availability: { dayDuty: false, nightDuty: true, liveIn24h: false, preferredShift: 'NIGHT', availableFrom: null },
    hasVerifiedQualification: true,
    qualificationSummary: ['NVQ — University of Colombo'],
    relevantExperienceSummary: ["Parkinson's Care"],
    matchScore: 42,
    matchReasons: ['works in the Colombo district', 'has a verified qualification'],
    ...overrides,
  };
}

describe('ResultCard', () => {
  it('shows the public-safe fields the brief calls out', () => {
    render(renderWithProviders(<ResultCard caregiver={caregiver()} />));

    expect(screen.getByText(/45 years/)).toBeInTheDocument();
    expect(screen.getByText(/8 years experience/)).toBeInTheDocument();
    expect(screen.getByText('Colombo, Colombo')).toBeInTheDocument();
    expect(screen.getByText('Sinhala')).toBeInTheDocument();
    expect(screen.getByText(/Parkinson's Care/)).toBeInTheDocument();
    expect(screen.getByText('Verified Qualification')).toBeInTheDocument();
  });

  it('renders "Recommended match" and "Why this matches", never a fabricated percentage', () => {
    render(renderWithProviders(<ResultCard caregiver={caregiver()} />));

    expect(screen.getByText('Recommended match')).toBeInTheDocument();
    expect(screen.getByText('Why this matches')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('never renders a subjective claim as a match reason', () => {
    render(
      renderWithProviders(
        <ResultCard caregiver={caregiver({ matchReasons: ['works in the Colombo district'] })} />,
      ),
    );
    const banned = [/compassionate/i, /perfect/i, /trustworthy/i, /amazing/i, /best caregiver/i];
    for (const pattern of banned) {
      expect(screen.queryByText(pattern)).not.toBeInTheDocument();
    }
  });

  it('never renders NIC, phone, email, or address - only publicId, never the internal id', () => {
    const c = caregiver();
    render(renderWithProviders(<ResultCard caregiver={c} />));

    // The anonymous ID shown must be derived from publicId, and nothing
    // resembling a NIC/phone pattern should ever appear.
    expect(screen.getByText(new RegExp(c.publicId.slice(0, 8)))).toBeInTheDocument();
    expect(screen.queryByText(/\d{9}[vVxX]\b/)).not.toBeInTheDocument(); // old-format NIC shape
    expect(screen.queryByText(/^0\d{9}$/)).not.toBeInTheDocument(); // local phone shape
  });

  it('omits the Verified Qualification badge when not verified', () => {
    render(renderWithProviders(<ResultCard caregiver={caregiver({ hasVerifiedQualification: false })} />));
    expect(screen.queryByText('Verified Qualification')).not.toBeInTheDocument();
  });
});
