import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import en from '../src/i18n/en.json';
import Profile from '../app/(caregiver)/profile';
import Me from '../app/(caregiver)/me';
import { changesBetween, contactDetailsOf, identityLocked, problemsIn } from '../src/caregiver/profile';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';
import { config } from '@/config';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

const record = (over: Record<string, unknown> = {}) =>
  ({
    id: 'cg-1',
    registrationNumber: 'CG-0042',
    status: 'UNDER_VERIFICATION',
    fullName: 'Nimali Perera',
    permanentAddress: '12 Temple Road, Dehiwala',
    nic: '199012345678',
    passportNumber: null,
    dateOfBirth: '1990-04-12',
    gender: 'FEMALE',
    civilStatus: 'MARRIED',
    heightIn: null,
    weightKg: null,
    primaryPhone: '+94771234567',
    secondaryPhone: null,
    emergencyContactName: 'Sunil Perera',
    emergencyContactNumber: '0771112222',
    emergencyContactRelationship: 'Husband',
    policeDivision: null,
    policeStation: null,
    preferredContactMethod: 'WHATSAPP',
    districtId: 1,
    cityId: 11,
    skills: [{ skillId: 'sk-1', name: 'Bathing' }],
    languages: [{ languageId: 'la-1', name: 'Sinhala' }],
    documents: [],
    ...over,
  }) as never;

const meta = {
  'GET /public/meta/locations/tree': () => ({
    status: 200,
    body: [{ id: 1, name: 'Western', districts: [{ id: 1, name: 'Colombo' }, { id: 2, name: 'Gampaha' }] }],
  }),
  'GET /public/meta/locations/cities': (_: unknown, q: Record<string, string>) => ({
    status: 200,
    body: q.districtId === '1' ? [{ id: 11, name: 'Dehiwala', subName: null }, { id: 12, name: 'Maharagama', subName: null }] : [{ id: 21, name: 'Negombo', subName: null }],
  }),
  'GET /skills': () => ({ status: 200, body: [{ id: 'sk-2', name: 'Feeding' }, { id: 'sk-1', name: 'Bathing' }] }),
  'GET /languages': () => ({ status: 200, body: [{ id: 'la-1', name: 'Sinhala' }, { id: 'la-2', name: 'Tamil' }] }),
  'GET /caregivers/cg-1/qualifications': () => ({
    status: 200,
    body: [{ id: 'q-1', name: 'NVQ Level 3 in Elderly Care', type: 'NVQ', institution: 'Tertiary and Vocational Education Commission', verificationStatus: 'VERIFIED' }],
  }),
  'GET /caregivers/cg-1/experiences': () => ({
    status: 200,
    body: [{ id: 'e-1', role: 'Home nurse', employerOrClient: 'Silva family', country: 'Sri Lanka', startDate: '2021-02-01', endDate: null, verificationStatus: 'PENDING' }],
  }),
};

const signIn = () => tokenStore.set(tokensFor('CAREGIVER', { caregiverId: 'cg-1', phone: '+94771234567' }));
const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);
const save = () => screen.getByRole('button', { name: en.common.save });
const field = (name: keyof typeof en.personalInfo.fields) => screen.getByLabelText(en.personalInfo.fields[name]);

beforeEach(() => mockRouter.reset());

describe('the profile rules', () => {
  const details = contactDetailsOf(record());

  it('locks identity once verification starts, as the API does', () => {
    expect(['DRAFT', 'REGISTERED', 'DOCUMENTS_PENDING'].map((s) => identityLocked(s as never))).toEqual([false, false, false]);
    expect(['UNDER_VERIFICATION', 'VERIFIED', 'ACTIVE', 'SUSPENDED'].map((s) => identityLocked(s as never))).toEqual([true, true, true, true]);
  });

  it("checks the website's rules", () => {
    expect(problemsIn(details)).toEqual({});
    expect(
      problemsIn({ ...details, permanentAddress: ' 12 ', districtId: null, cityId: null, emergencyContactName: '', emergencyContactNumber: '0771', emergencyContactRelationship: 'x' }),
    ).toEqual({
      permanentAddress: 'invalid',
      district: 'required',
      city: 'required',
      emergencyContactName: 'required',
      emergencyContactNumber: 'invalid',
      emergencyContactRelationship: 'invalid',
    });
    expect(problemsIn({ ...details, emergencyContactNumber: '  ' }).emergencyContactNumber).toBe('required');
  });

  it('sends only what changed, trimmed', () => {
    expect(changesBetween(details, { ...details, permanentAddress: '12 Temple Road, Dehiwala  ' })).toEqual({});
    expect(changesBetween(details, { ...details, secondaryPhone: ' 0112223333 ', cityId: 12 })).toEqual({ secondaryPhone: '0112223333', cityId: 12 });
    expect(changesBetween({ ...details, secondaryPhone: '0112223333' }, details)).toEqual({ secondaryPhone: '' });
  });
});

describe('Profile', () => {
  it('shows who the caregiver is, locked while being verified, and their qualifications and work', async () => {
    await signIn();
    serveApi({ 'GET /caregivers/cg-1': () => ({ status: 200, body: record() }), ...meta });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await show(<Profile />);

    expect(await screen.findByText('Nimali Perera')).toBeTruthy();
    expect(screen.getByText('+94771234567')).toBeTruthy();
    expect(screen.getByText('12 Apr 1990')).toBeTruthy();
    expect(screen.getByText(en.personalInfo.options.gender.FEMALE)).toBeTruthy();
    expect(screen.getByText('199012345678')).toBeTruthy();
    expect(screen.getByText(en.portal.profile.identityLocked)).toBeTruthy();
    expect(screen.queryByText(en.portal.profile.identityOnWebsite)).toBeNull();
    // Identity isn't a field anywhere here.
    expect(screen.queryByLabelText(en.personalInfo.fields.fullName)).toBeNull();

    expect(await screen.findByText('NVQ Level 3 in Elderly Care')).toBeTruthy();
    expect(screen.getByText(`Tertiary and Vocational Education Commission · ${en.portal.qualifications.types.NVQ}`)).toBeTruthy();
    expect(screen.getByText('Home nurse — Silva family')).toBeTruthy();
    expect(screen.getByText(`Sri Lanka · 1 Feb 2021 → ${en.portal.experience.present}`)).toBeTruthy();
    expect(screen.getByText(en.portal.verification.VERIFIED)).toBeTruthy();
    // Added and changed on the website.
    await fireEvent.press(screen.getByRole('button', { name: en.portal.profile.openWebsite }));
    expect(open).toHaveBeenCalledWith(`${config.siteUrl}/caregiver/profile`);
    open.mockRestore();
  });

  it('points to the website for identity corrections before verification starts', async () => {
    await signIn();
    serveApi({ 'GET /caregivers/cg-1': () => ({ status: 200, body: record({ status: 'DOCUMENTS_PENDING' }) }), ...meta });
    await show(<Profile />);
    expect(await screen.findByText(en.portal.profile.identityOnWebsite)).toBeTruthy();
    expect(screen.queryByText(en.portal.profile.identityLocked)).toBeNull();
    expect(screen.getByRole('link', { name: en.portal.profile.openWebsite })).toBeTruthy();
  });

  it('saves changed contact details - only those - and says so', async () => {
    await signIn();
    let current = record();
    const calls = serveApi({
      'GET /caregivers/cg-1': () => ({ status: 200, body: current }),
      'PATCH /caregivers/cg-1/profile': (body) => {
        current = { ...(current as object), ...body } as never;
        return { status: 200, body: current };
      },
      ...meta,
    });
    await show(<Profile />);
    await screen.findByText('Nimali Perera');
    expect(save().props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(field('secondaryPhone'), ' 0112223333 ');
    await fireEvent.changeText(field('emergencyContactNumber'), '0779998888');
    await fireEvent.press(screen.getByRole('radio', { name: en.personalInfo.options.contactMethod.PHONE_CALL }));
    expect(screen.getByText(en.personalInfo.hints.phoneCall)).toBeTruthy();
    await fireEvent.press(save());

    expect(await screen.findByText(en.portal.saved)).toBeTruthy();
    expect(calls.find((c) => c.route === 'PATCH /caregivers/cg-1/profile')!.body).toEqual({
      secondaryPhone: '0112223333',
      emergencyContactNumber: '0779998888',
      preferredContactMethod: 'PHONE_CALL',
    });
    // Nothing left to save: the form now matches what was saved.
    await waitFor(() => expect(save().props.accessibilityState.disabled).toBe(true));
    expect(field('secondaryPhone').props.value).toBe('0112223333');
  });

  it('moves to another district and city', async () => {
    await signIn();
    const calls = serveApi({
      'GET /caregivers/cg-1': () => ({ status: 200, body: record() }),
      'PATCH /caregivers/cg-1/profile': (body) => ({ status: 200, body: { ...(record() as object), ...body } }),
      ...meta,
    });
    await show(<Profile />);
    await screen.findByText('Nimali Perera');
    await fireEvent.press(screen.getByRole('button', { name: en.personalInfo.fields.district }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Gampaha' }));
    // The old city isn't in the new district: one has to be chosen.
    await fireEvent.press(save());
    expect(screen.getByText(en.personalInfo.validation.city.required)).toBeTruthy();
    expect(calls.some((c) => c.route.startsWith('PATCH'))).toBe(false);

    await fireEvent.press(screen.getByRole('button', { name: en.personalInfo.fields.city }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Negombo' }));
    await fireEvent.press(save());
    expect(await screen.findByText(en.portal.saved)).toBeTruthy();
    expect(calls.find((c) => c.route === 'PATCH /caregivers/cg-1/profile')!.body).toEqual({ districtId: 2, cityId: 21 });
  });

  it("doesn't send details that break the website's rules", async () => {
    await signIn();
    const calls = serveApi({ 'GET /caregivers/cg-1': () => ({ status: 200, body: record() }), ...meta });
    await show(<Profile />);
    await screen.findByText('Nimali Perera');
    await fireEvent.changeText(field('permanentAddress'), 'Home');
    await fireEvent.changeText(field('emergencyContactName'), '');
    // Errors wait until Save is pressed.
    expect(screen.queryByText(en.personalInfo.validation.permanentAddress.invalid)).toBeNull();
    await fireEvent.press(save());
    expect(screen.getByText(en.personalInfo.validation.permanentAddress.invalid)).toBeTruthy();
    expect(screen.getByText(en.personalInfo.validation.emergencyContactName.required)).toBeTruthy();
    expect(calls.some((c) => c.route.startsWith('PATCH'))).toBe(false);
  });

  it("shows the API's reason when it refuses", async () => {
    await signIn();
    serveApi({
      'GET /caregivers/cg-1': () => ({ status: 200, body: record() }),
      'PATCH /caregivers/cg-1/profile': () => ({ status: 400, body: { message: 'This phone number is already registered' } }),
      ...meta,
    });
    await show(<Profile />);
    await screen.findByText('Nimali Perera');
    await fireEvent.changeText(field('secondaryPhone'), '0771234567');
    await fireEvent.press(save());
    expect(await screen.findByText('This phone number is already registered')).toBeTruthy();
    expect(screen.queryByText(en.portal.saved)).toBeNull();
  });

  it('ticks and unticks skills and languages straight away', async () => {
    await signIn();
    let skills = [{ skillId: 'sk-1', name: 'Bathing' }];
    const calls = serveApi({
      'GET /caregivers/cg-1': () => ({ status: 200, body: record({ skills }) }),
      'POST /caregivers/cg-1/skills': (body) => {
        skills = [...skills, { skillId: String(body.skillId), name: 'Feeding' }];
        return { status: 201, body: {} };
      },
      'DELETE /caregivers/cg-1/skills/sk-1': () => {
        skills = skills.filter((s) => s.skillId !== 'sk-1');
        return { status: 204 };
      },
      'POST /caregivers/cg-1/languages': () => ({ status: 400, body: { message: 'Language already added' } }),
      ...meta,
    });
    await show(<Profile />);
    const feeding = await screen.findByRole('checkbox', { name: 'Feeding' });
    expect(feeding.props.accessibilityState.checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Bathing' }).props.accessibilityState.checked).toBe(true);

    await fireEvent.press(feeding);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Feeding' }).props.accessibilityState.checked).toBe(true));
    expect(calls.find((c) => c.route === 'POST /caregivers/cg-1/skills')!.body).toEqual({ skillId: 'sk-2' });

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Bathing' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Bathing' }).props.accessibilityState.checked).toBe(false));
    expect(calls.some((c) => c.route === 'DELETE /caregivers/cg-1/skills/sk-1')).toBe(true);

    // A refused tick says why, and stays unticked.
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Tamil' }));
    expect(await screen.findByText('Language already added')).toBeTruthy();
    expect(calls.find((c) => c.route === 'POST /caregivers/cg-1/languages')!.body).toEqual({ languageId: 'la-2' });
    expect(screen.getByRole('checkbox', { name: 'Tamil' }).props.accessibilityState.checked).toBe(false);
  });
});

it('Me opens the profile', async () => {
  await signIn();
  serveApi({ 'GET /caregivers/cg-1': () => ({ status: 200, body: record() }) });
  await show(<Me />);
  await fireEvent.press(screen.getByRole('button', { name: en.portal.profile.title }));
  expect(mockRouter.navigate).toHaveBeenCalledWith('/profile');
});
