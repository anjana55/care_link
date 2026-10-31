import { Pressable, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { fireEvent, renderRouter } from 'expo-router/testing-library';
import CaregiverTabs from '../app/(caregiver)/_layout';
import ClientTabs from '../app/(client)/_layout';
import { AppProviders } from '../test-utils/app';

/**
 * The app's real tab layouts with the real router (the screens themselves are
 * stand-ins). Screens without a tab button - Documents, Profile, Saved, Invoices - must
 * still open from the screens that link to them: hiding them with
 * `href: null` made the router send people straight back.
 */
// The tab icons' font file isn't something Jest can load; the icons aren't the subject.
jest.mock('@expo/vector-icons/Ionicons', () => Object.assign(() => null, { glyphMap: {} }));

const goTo = (path: '/documents' | '/profile' | '/saved' | '/invoices') =>
  function From() {
    const router = useRouter();
    return (
      <Pressable accessibilityRole="button" onPress={() => router.navigate(path)}>
        <Text>go</Text>
      </Pressable>
    );
  };
const page = (name: string) => () => <Text>{name}</Text>;

const app = (from: Record<string, () => React.JSX.Element>) =>
  renderRouter(
    {
      _layout: () => (
        <AppProviders>
          <Stack screenOptions={{ headerShown: false }} />
        </AppProviders>
      ),
      '(caregiver)/_layout': CaregiverTabs,
      '(caregiver)/home': page('Today'),
      '(caregiver)/shifts': page('Shifts'),
      '(caregiver)/payments': page('Payments'),
      '(caregiver)/me': page('Me'),
      '(caregiver)/documents': page('Documents'),
      '(caregiver)/profile': page('Profile'),
      '(client)/_layout': ClientTabs,
      '(client)/find': page('Find'),
      '(client)/bookings': page('Bookings'),
      '(client)/requests': page('Requests'),
      '(client)/account': page('Account'),
      '(client)/saved': page('Saved'),
      '(client)/invoices': page('Invoices'),
      ...from,
    },
    { initialUrl: Object.keys(from)[0].replace(/^\(\w+\)/, '') },
  );

describe('screens without a tab button', () => {
  it.each([
    ['(caregiver)/home', '/documents', 'Documents'],
    ['(caregiver)/me', '/documents', 'Documents'],
    ['(caregiver)/me', '/profile', 'Profile'],
    ['(client)/account', '/saved', 'Saved'],
    ['(client)/account', '/invoices', 'Invoices'],
  ] as const)('%s opens %s', async (from, path, name) => {
    const r = await app({ [from]: goTo(path) });
    await fireEvent.press(r.getByText('go'));
    expect(r.getPathname()).toBe(path);
    expect(r.getByText(name)).toBeTruthy();
  });

  it('have no tab button of their own', async () => {
    const r = await app({ '(caregiver)/me': page('Me') });
    expect(r.queryByRole('button', { name: /documents/i })).toBeNull();
    expect(r.queryByRole('button', { name: /profile/i })).toBeNull();
    expect(r.getByRole('button', { name: /Shifts/ })).toBeTruthy();
  });
});
