import CaregiverJoinPage from '@/app/caregiver/join/page';

const redirect = jest.fn();
jest.mock('next/navigation', () => ({
  redirect: (...a: unknown[]) => redirect(...a),
}));

/**
 * /caregiver/join used to be a chooser between email and WhatsApp sign-up. It
 * survives only so old links, the sign-in pages and the dashboard's sign-out
 * land on the one registration form instead of a 404.
 */
describe('Caregiver join route', () => {
  it('redirects straight to the single registration form', () => {
    CaregiverJoinPage();
    expect(redirect).toHaveBeenCalledWith('/caregiver/signup');
  });
});
