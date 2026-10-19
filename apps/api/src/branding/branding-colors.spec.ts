import {
  DEFAULT_BRANDING,
  contrastRatio,
  derivePalette,
  makeAccessible,
  meetsBrandContrast,
  normalizeBranding,
  paletteCss,
} from '@care-platform/shared';

/**
 * The colour rules shared by Settings > Branding, the API and both web apps
 * (packages/shared branding.ts).
 */
describe('branding colours', () => {
  it('gives an untouched deployment exactly the hand-tuned palette it shipped with', () => {
    expect(derivePalette('#5F6952', '#2F7A84')).toEqual({
      brand: '#5F6952',
      brandDark: '#4F5745',
      brandLight: '#E4E8DE',
      accent: '#2F7A84',
      accentDark: '#2A6B74',
      accentLight: '#DCE8EA',
      paper: '#F6F8F2',
      border: '#DCE0D6',
    });
  });

  it('derives darker and lighter shades of a custom colour', () => {
    const p = derivePalette('#1A5FB4', '#8F3B76');
    expect(contrastRatio(p.brandDark, '#FFFFFF')).toBeGreaterThan(contrastRatio(p.brand, '#FFFFFF'));
    expect(contrastRatio(p.brandLight, '#FFFFFF')).toBeLessThan(1.5);
    expect(contrastRatio(p.paper, '#FFFFFF')).toBeLessThan(contrastRatio(p.border, '#FFFFFF'));
  });

  it('turns a too-light colour into the nearest readable shade of the same hue', () => {
    expect(meetsBrandContrast('#4FA3F7')).toBe(false);
    const fixed = makeAccessible('#4FA3F7');
    expect(meetsBrandContrast(fixed)).toBe(true);
    // Barely past the line, not black.
    expect(contrastRatio(fixed, '#FFFFFF')).toBeLessThan(5.2);
    expect(makeAccessible('#5F6952')).toBe('#5F6952');
  });

  it('writes the palette as bare channels for tailwind', () => {
    expect(paletteCss(derivePalette('#5F6952', '#2F7A84'))).toContain('--color-brand:95 105 82');
  });

  it('treats malformed or unreadable branding from the network as the default', () => {
    expect(normalizeBranding(null)).toEqual(DEFAULT_BRANDING);
    const b = normalizeBranding({ companyName: '  Acme  ', primaryColor: '#FFFF00', accentColor: 'red', defaultLocale: 'xx', enabledLocales: ['ta'], logoVersion: '../x' });
    expect(b).toMatchObject({ companyName: 'Acme', shortName: 'AC', primaryColor: '#5F6952', accentColor: '#2F7A84', defaultLocale: 'en', enabledLocales: ['en', 'ta'], logoVersion: null });
  });
});
