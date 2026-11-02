import { fireEvent, render, screen } from '@testing-library/react-native';
import { DEFAULT_BRANDING, type PublicBranding } from '@care-platform/shared';
import { BrandLogo, BrandMark } from '../src/ui/visual';
import { AppProviders, serveApi } from '../test-utils/app';


/**
 * The deployment's artwork from Settings > Branding, in the app: each piece
 * where it belongs, always as a PNG (the app can't draw SVG), and the
 * company name standing in for whatever isn't uploaded or doesn't load.
 */

const WITH_ART: PublicBranding = {
  ...DEFAULT_BRANDING,
  companyName: 'Golden Years Care',
  logoVersion: 'aaa111',
  assets: { logo: 'aaa111', logoReverse: 'bbb222', symbol: 'ccc333', appIcon: 'ddd444' },
};
const API = 'https://find.caregivers.lk/api';

const show = (ui: React.ReactElement, branding: Partial<PublicBranding>) => {
  serveApi({ 'GET /branding': () => ({ status: 200, body: branding }) });
  return render(<AppProviders>{ui}</AppProviders>);
};
const images = () => screen.queryAllByTestId('brand-art').map((i) => (i.props as { source: { uri: string } }).source.uri);

it('puts the reverse logo on the brand colour, the full logo elsewhere, and the symbol in small places', async () => {
  await show(
    <>
      <BrandLogo reverse />
      <BrandLogo />
      <BrandMark size={48} />
    </>,
    WITH_ART,
  );
  await screen.findAllByLabelText('Golden Years Care');
  expect(images()).toEqual([
    `${API}/branding/logo-reverse?v=bbb222&size=512`,
    `${API}/branding/logo?v=aaa111&size=512`,
    `${API}/branding/symbol?v=ccc333&size=192`,
  ]);
});

it('shows the symbol and the company name where there is no artwork', async () => {
  await show(<BrandLogo reverse />, { ...DEFAULT_BRANDING, companyName: 'Golden Years Care' });
  expect(await screen.findByText('Golden Years Care')).toBeTruthy();
  expect(images()).toEqual([]);
});

it('falls back to the name when the logo will not load', async () => {
  await show(<BrandLogo />, WITH_ART);
  await screen.findAllByLabelText('Golden Years Care');
  const logo = screen.getAllByTestId('brand-art')[0];
  await fireEvent(logo, 'error');
  expect(await screen.findByText('Golden Years Care')).toBeTruthy();
  // The symbol still shows beside it.
  expect(images()).toEqual([`${API}/branding/symbol?v=ccc333&size=192`]);
});

it('reads branding from an API from before the artwork list: its logo still shows', async () => {
  const old = { ...DEFAULT_BRANDING, companyName: 'Golden Years Care', logoVersion: 'aaa111' } as Partial<PublicBranding>;
  delete old.assets;
  await show(
    <>
      <BrandLogo />
      <BrandLogo reverse />
    </>,
    old,
  );
  await screen.findAllByLabelText('Golden Years Care');
  expect(images()).toEqual([`${API}/branding/logo?v=aaa111&size=512`]);
  expect(screen.getByText('Golden Years Care')).toBeTruthy();
});
