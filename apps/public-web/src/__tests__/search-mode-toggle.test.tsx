import { render, screen, fireEvent } from '@testing-library/react';
import { SearchModeToggle } from '@/components/search/search-mode-toggle';
import { renderWithProviders } from '@/lib/test/test-utils';

describe('SearchModeToggle', () => {
  it('disables the AI tab and shows an explanation when AI search is not enabled', () => {
    const onChange = jest.fn();
    render(renderWithProviders(<SearchModeToggle mode="normal" onChange={onChange} aiEnabled={false} />));

    const aiTab = screen.getByRole('tab', { name: 'AI Search' });
    expect(aiTab).toBeDisabled();
    fireEvent.click(aiTab);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
  });

  it('allows switching to AI mode once enabled', () => {
    const onChange = jest.fn();
    render(renderWithProviders(<SearchModeToggle mode="normal" onChange={onChange} aiEnabled={true} />));

    fireEvent.click(screen.getByRole('tab', { name: 'AI Search' }));
    expect(onChange).toHaveBeenCalledWith('ai');
  });

  it('reflects the currently selected mode via aria-selected', () => {
    render(renderWithProviders(<SearchModeToggle mode="normal" onChange={jest.fn()} aiEnabled={true} />));
    expect(screen.getByRole('tab', { name: 'Normal Search' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'AI Search' })).toHaveAttribute('aria-selected', 'false');
  });
});
