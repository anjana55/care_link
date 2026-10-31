import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { CaregiverDocument } from '@care-platform/shared';
import en from '../src/i18n/en.json';
import Documents from '../app/(caregiver)/documents';
import Today from '../app/(caregiver)/home';
import Me from '../app/(caregiver)/me';
import {
  asksExpiry,
  documentTypeFor,
  expiryFrom,
  hasExpired,
  MAX_BYTES,
  missingCore,
  normaliseFile,
  problemWith,
} from '../src/caregiver/documents';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';
import { config } from '@/config';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());
// Today sets activity reminders; not the subject here.
jest.mock('expo-device', () => ({ isDevice: false }));

// The camera, photos, file picker and viewer: what each "returns" is set per test.
const mockFiles = {
  photo: null as unknown,
  library: null as unknown,
  file: null as unknown,
  opened: [] as { url: string; headers: Record<string, string>; doc: Record<string, string> }[],
  openFails: [] as Error[],
  cleared: 0,
};
jest.mock('../src/caregiver/document-files', () => ({
  takePhoto: async () => mockFiles.photo,
  choosePhoto: async () => mockFiles.library,
  chooseFile: async () => mockFiles.file,
  clearViewedDocuments: () => void mockFiles.cleared++,
  openDocument: async (url: string, headers: Record<string, string>, doc: Record<string, string>) => {
    mockFiles.opened.push({ url, headers, doc });
    const fail = mockFiles.openFails.shift();
    if (fail) throw fail;
  },
}));

const doc = (n: number, over: Partial<CaregiverDocument> = {}): CaregiverDocument => ({
  id: `d-${n}`,
  documentType: 'NIC',
  originalFilename: `scan-${n}.jpg`,
  mimeType: 'image/jpeg',
  sizeBytes: 2_400_000,
  verificationStatus: 'PENDING',
  verifiedAt: null,
  expiresOn: null,
  createdAt: `2026-10-0${n}T05:00:00.000Z`,
  ...over,
});

const photo = { file: { uri: 'file:///cache/ImagePicker/abc.jpg', name: 'abc.jpg', mimeType: 'image/jpeg', size: 1_800_000 } };

const signIn = () => tokenStore.set(tokensFor('CAREGIVER', { caregiverId: 'cg-1', phone: '+94771234567' }));
const show = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);
const choose = async (field: string, option: string) => {
  await fireEvent.press(screen.getByRole('button', { name: field }));
  // Long lists (days, years) have a filter box; typing narrows them to the one wanted.
  const filter = screen.queryByPlaceholderText('…');
  if (filter) await fireEvent.changeText(filter, option);
  await fireEvent.press(await screen.findByRole('radio', { name: option }));
};
const upload = () => screen.getByRole('button', { name: en.portal.documents.upload });

beforeEach(() => {
  mockRouter.reset();
  mockFiles.photo = mockFiles.library = mockFiles.file = { canceled: true };
  mockFiles.opened = [];
  mockFiles.openFails = [];
  mockFiles.cleared = 0;
});

describe('the upload rules', () => {
  it('names a picked file after its type, which the API checks', () => {
    // A camera photo with no name.
    expect(normaliseFile({ uri: 'file:///c/ImagePicker/9F2A', name: null, mimeType: 'image/jpeg', size: 10 })).toMatchObject({ name: '9F2A.jpg', mimeType: 'image/jpeg' });
    // An iPhone photo still called .heic after it was turned into a JPEG.
    expect(normaliseFile({ uri: 'file:///x.heic', name: 'IMG_1.HEIC', mimeType: 'image/jpeg' }).name).toBe('IMG_1.jpg');
    // A file with no type: worked out from the name.
    expect(normaliseFile({ uri: 'content://x', name: 'police.PDF', mimeType: null, size: 5 })).toMatchObject({ name: 'police.PDF', mimeType: 'application/pdf', size: 5 });
    expect(normaliseFile({ uri: 'file:///a.png', name: 'a.png', mimeType: 'image/png', size: undefined }).size).toBe(0);
  });

  it('turns away the types and sizes the API would refuse', () => {
    const ok = normaliseFile({ uri: 'u', name: 'id.jpg', mimeType: 'image/jpeg', size: MAX_BYTES });
    expect(problemWith(ok)).toBeNull();
    expect(problemWith({ ...ok, size: MAX_BYTES + 1 })).toBe('tooLarge');
    expect(problemWith(normaliseFile({ uri: 'u', name: 'cv.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))).toBe('badType');
    expect(problemWith(normaliseFile({ uri: 'u', name: 'id.heic', mimeType: 'image/heic' }))).toBe('badType');
    expect(problemWith({ ...ok, name: 'id.png' })).toBe('badType');
  });

  it('files each choice as the right document type, and asks for an expiry date only where one applies', () => {
    expect(documentTypeFor('identity', 'NIC')).toBe('NIC');
    expect(documentTypeFor('identity', 'PASSPORT')).toBe('PASSPORT');
    expect(documentTypeFor('police', 'NIC')).toBe('POLICE_CLEARANCE');
    expect(documentTypeFor('gn', 'NIC')).toBe('GRAMA_NILADHARI_CERTIFICATE');
    expect(documentTypeFor('other', 'PASSPORT')).toBe('OTHER');
    expect([asksExpiry('identity', 'NIC'), asksExpiry('identity', 'PASSPORT'), asksExpiry('police', 'NIC'), asksExpiry('gn', 'NIC'), asksExpiry('other', 'NIC')]).toEqual([
      false,
      true,
      true,
      false,
      true,
    ]);
  });

  it('reads the expiry date from the day, month and year', () => {
    expect(expiryFrom(null, null, null)).toBeNull();
    expect(expiryFrom(2027, null, 3)).toBe('partial');
    expect(expiryFrom(2027, 4, 31)).toBe('invalid');
    expect(expiryFrom(2027, 2, 29)).toBe('invalid');
    expect(expiryFrom(2028, 2, 29)).toBe('2028-02-29');
    expect(expiryFrom(2027, 3, 5)).toBe('2027-03-05');
    // Sri Lanka's day: 20:00 UTC on 31 Oct is already 1 Nov there.
    expect(hasExpired('2026-10-31', new Date('2026-10-31T20:00:00Z'))).toBe(true);
    expect(hasExpired('2026-10-31', new Date('2026-10-31T10:00:00Z'))).toBe(false);
  });

  it('knows which of the documents staff need are still missing', () => {
    expect(missingCore([])).toEqual(['identity', 'police', 'gn']);
    expect(missingCore([{ documentType: 'PASSPORT' }, { documentType: 'OTHER' }])).toEqual(['police', 'gn']);
    expect(missingCore([{ documentType: 'NIC' }, { documentType: 'POLICE_CLEARANCE' }, { documentType: 'GRAMA_NILADHARI_CERTIFICATE' }])).toEqual([]);
  });
});

describe('Documents', () => {
  it('lists what has been uploaded and where each one stands', async () => {
    await signIn();
    serveApi({
      'GET /caregivers/cg-1/documents': () => ({
        status: 200,
        body: [
          doc(1, { verificationStatus: 'VERIFIED' }),
          doc(3, { documentType: 'POLICE_CLEARANCE', verificationStatus: 'REJECTED', originalFilename: 'police.pdf', mimeType: 'application/pdf', sizeBytes: 300_000 }),
          doc(2, { documentType: 'PASSPORT', expiresOn: '2020-01-01', verificationStatus: 'IN_PROGRESS' }),
        ],
      }),
    });
    await show(<Documents />);

    // Newest first.
    expect(await screen.findByText(en.portal.documents.types.POLICE_CLEARANCE)).toBeTruthy();
    expect(screen.getAllByText(/^scan-|^police/).map((n) => String(n.props.children[0]))).toEqual(['police.pdf', 'scan-2.jpg', 'scan-1.jpg']);
    expect(screen.getByText(en.portal.verification.VERIFIED)).toBeTruthy();
    expect(screen.getByText(en.portal.verification.REJECTED)).toBeTruthy();
    expect(screen.getByText(en.portal.verification.IN_PROGRESS)).toBeTruthy();
    expect(screen.getByText(en.portal.documents.rejectedHint)).toBeTruthy();
    expect(screen.getByText(en.portal.documents.expires.replace('{date}', '1 Jan 2020'))).toBeTruthy();

    // Identity and police are in (a rejected one is still listed, with its own message); the GN certificate isn't.
    expect(screen.getByLabelText(`${en.portal.documents.core.identity}: ${en.portal.documents.haveIt}`)).toBeTruthy();
    expect(screen.getByLabelText(`${en.portal.documents.core.gn}: ${en.portal.documents.missing}`)).toBeTruthy();

    // Only documents staff haven't started on can be withdrawn: the rejected one here.
    expect(screen.getAllByRole('link', { name: en.portal.documents.remove })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: en.portal.documents.view })).toHaveLength(3);
  });

  it('uploads a photographed passport with its expiry date', async () => {
    await signIn();
    let listed: CaregiverDocument[] = [];
    const calls = serveApi({
      'GET /caregivers/cg-1/documents': () => ({ status: 200, body: listed }),
      'POST /caregivers/cg-1/documents': () => {
        listed = [doc(1, { documentType: 'PASSPORT', originalFilename: 'abc.jpg', expiresOn: '2031-06-15' })];
        return { status: 201, body: listed[0] };
      },
    });
    await show(<Documents />);
    expect(await screen.findByText(en.portal.documents.none)).toBeTruthy();
    // Nothing to upload yet.
    expect(upload().props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByRole('radio', { name: en.portal.documents.idKinds.PASSPORT }));
    await choose(en.portal.documents.day, '15');
    await choose(en.portal.documents.month, 'June');
    await choose(en.portal.documents.year, '2031');
    mockFiles.photo = photo;
    await fireEvent.press(screen.getByRole('button', { name: en.portal.documents.takePhoto }));
    expect(await screen.findByText(en.portal.documents.selected.replace('{name}', 'abc.jpg').replace('{size}', '1.7 MB'))).toBeTruthy();
    await fireEvent.press(upload());

    expect(await screen.findByText(en.portal.documents.uploaded)).toBeTruthy();
    const sent = calls.find((c) => c.route === 'POST /caregivers/cg-1/documents')!;
    expect(sent.body).toEqual({
      documentType: 'PASSPORT',
      expiresOn: '2031-06-15',
      file: { uri: 'file:///cache/ImagePicker/abc.jpg', name: 'abc.jpg', type: 'image/jpeg' },
    });
    // Sent as a form, so the phone sets the multipart boundary itself.
    expect(sent.headers['Content-Type']).toBeUndefined();
    expect(sent.headers.Authorization).toMatch(/^Bearer /);
    // The list reloads with it.
    expect(await screen.findByText(en.portal.documents.expires.replace('{date}', '15 Jun 2031'))).toBeTruthy();
    expect(screen.queryByText(/Ready to upload/)).toBeNull();
  });

  it("sends no expiry date for documents that don't have one", async () => {
    await signIn();
    const calls = serveApi({
      'GET /caregivers/cg-1/documents': () => ({ status: 200, body: [] }),
      'POST /caregivers/cg-1/documents': () => ({ status: 201, body: doc(1) }),
    });
    await show(<Documents />);
    await choose(en.portal.documents.type, en.portal.documents.pick.gn);
    expect(screen.queryByRole('button', { name: en.portal.documents.day })).toBeNull();
    mockFiles.file = { file: { uri: 'content://gn.pdf', name: 'gn.pdf', mimeType: 'application/pdf', size: 90_000 } };
    await fireEvent.press(screen.getByRole('button', { name: en.portal.documents.chooseFile }));
    await fireEvent.press(await screen.findByRole('button', { name: en.portal.documents.upload }));
    expect(await screen.findByText(en.portal.documents.uploaded)).toBeTruthy();
    expect(calls.find((c) => c.route === 'POST /caregivers/cg-1/documents')!.body).toEqual({
      documentType: 'GRAMA_NILADHARI_CERTIFICATE',
      file: { uri: 'content://gn.pdf', name: 'gn.pdf', type: 'application/pdf' },
    });
  });

  it('asks for a whole expiry date, and a real one', async () => {
    await signIn();
    const calls = serveApi({ 'GET /caregivers/cg-1/documents': () => ({ status: 200, body: [] }) });
    await show(<Documents />);
    await choose(en.portal.documents.type, en.portal.documents.pick.police);
    mockFiles.library = photo;
    await fireEvent.press(screen.getByRole('button', { name: en.portal.documents.choosePhoto }));
    await choose(en.portal.documents.day, '31');
    await fireEvent.press(await screen.findByRole('button', { name: en.portal.documents.upload }));
    expect(screen.getByText(en.portal.documents.partDate)).toBeTruthy();

    await choose(en.portal.documents.month, 'April');
    await choose(en.portal.documents.year, String(new Date().getFullYear() + 1));
    await fireEvent.press(upload());
    expect(screen.getByText(en.portal.documents.badDate)).toBeTruthy();
    expect(calls.some((c) => c.route.startsWith('POST'))).toBe(false);
  });

  it("says why a file can't be used", async () => {
    await signIn();
    serveApi({ 'GET /caregivers/cg-1/documents': () => ({ status: 200, body: [] }) });
    await show(<Documents />);
    await screen.findByText(en.portal.documents.none);

    mockFiles.photo = { error: 'cameraDenied' };
    await fireEvent.press(screen.getByRole('button', { name: en.portal.documents.takePhoto }));
    expect(await screen.findByText(en.portal.documents.cameraDenied)).toBeTruthy();

    // A build made before the camera was added.
    mockFiles.library = { error: 'unsupported' };
    await fireEvent.press(screen.getByRole('button', { name: en.portal.documents.choosePhoto }));
    expect(await screen.findByText(en.portal.documents.unsupported)).toBeTruthy();

    mockFiles.file = { file: { uri: 'content://cv', name: 'cv.docx', mimeType: 'application/msword', size: 1000 } };
    await fireEvent.press(screen.getByRole('button', { name: en.portal.documents.chooseFile }));
    expect(await screen.findByText(en.portal.documents.badType)).toBeTruthy();

    mockFiles.file = { file: { uri: 'content://big', name: 'big.pdf', mimeType: 'application/pdf', size: MAX_BYTES + 1 } };
    await fireEvent.press(screen.getByRole('button', { name: en.portal.documents.chooseFile }));
    expect(await screen.findByText(en.portal.documents.tooLarge)).toBeTruthy();
    expect(upload().props.accessibilityState.disabled).toBe(true);
  });

  it("shows the API's reason when it refuses an upload", async () => {
    await signIn();
    serveApi({
      'GET /caregivers/cg-1/documents': () => ({ status: 200, body: [] }),
      'POST /caregivers/cg-1/documents': () => ({ status: 400, body: { message: 'You can keep at most 20 documents. Remove one first.' } }),
    });
    await show(<Documents />);
    mockFiles.photo = photo;
    await fireEvent.press(screen.getByRole('button', { name: en.portal.documents.takePhoto }));
    await fireEvent.press(await screen.findByRole('button', { name: en.portal.documents.upload }));
    expect(await screen.findByText('You can keep at most 20 documents. Remove one first.')).toBeTruthy();
  });

  it('withdraws a document after asking', async () => {
    await signIn();
    let listed = [doc(1)];
    const calls = serveApi({
      'GET /caregivers/cg-1/documents': () => ({ status: 200, body: listed }),
      'DELETE /caregivers/cg-1/documents/d-1': () => {
        listed = [];
        return { status: 204 };
      },
    });
    const alert = jest.spyOn(Alert, 'alert');
    await show(<Documents />);
    await fireEvent.press(await screen.findByRole('link', { name: en.portal.documents.remove }));
    expect(alert).toHaveBeenCalledWith(en.portal.documents.confirmRemove, en.portal.documents.types.NIC, expect.any(Array));
    expect(calls.some((c) => c.route.startsWith('DELETE'))).toBe(false);

    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === en.portal.documents.remove)!.onPress!());
    expect(await screen.findByText(en.portal.documents.removed)).toBeTruthy();
    expect(calls.some((c) => c.route === 'DELETE /caregivers/cg-1/documents/d-1')).toBe(true);
    expect(await screen.findByText(en.portal.documents.none)).toBeTruthy();
    alert.mockRestore();
  });

  it("opens a document with the sign-in header, renewing an expired session once, and clears the copy when it closes", async () => {
    await signIn();
    const fresh = tokensFor('CAREGIVER', { caregiverId: 'cg-1', sub: 'u-1', expiresInSeconds: 1800 });
    serveApi({
      'GET /caregivers/cg-1/documents': () => ({ status: 200, body: [doc(1, { mimeType: 'application/pdf', originalFilename: 'nic.pdf' })] }),
      'POST /auth/refresh': () => ({ status: 200, body: fresh }),
    });
    const before = tokenStore.get()!.accessToken;
    mockFiles.openFails = [new Error('Unable to download file: 401')];
    const { unmount } = await show(<Documents />);
    await fireEvent.press(await screen.findByRole('link', { name: en.portal.documents.view }));

    await waitFor(() => expect(mockFiles.opened).toHaveLength(2));
    expect(mockFiles.opened[0]).toEqual({
      url: `${config.apiUrl}/caregivers/cg-1/documents/d-1/file`,
      headers: { 'Accept-Language': 'en', Authorization: `Bearer ${before}` },
      doc: { id: 'd-1', mimeType: 'application/pdf', title: en.portal.documents.types.NIC },
    });
    expect(mockFiles.opened[1].headers.Authorization).toBe(`Bearer ${fresh.accessToken}`);
    expect(screen.queryByText(en.portal.documents.openError)).toBeNull();

    // Anything else isn't retried: it's said.
    mockFiles.openFails = [new Error('no viewer')];
    await fireEvent.press(screen.getByRole('link', { name: en.portal.documents.view }));
    expect(await screen.findByText(en.portal.documents.openError)).toBeTruthy();
    expect(mockFiles.opened).toHaveLength(3);

    const cleared = mockFiles.cleared;
    await unmount();
    expect(mockFiles.cleared).toBe(cleared + 1);
  });
});

describe('getting to Documents', () => {
  const record = (documents: { id: string; documentType: string; verificationStatus: string }[]) => ({
    id: 'cg-1',
    fullName: 'Nimali Perera',
    registrationNumber: 'CG-0042',
    status: 'DOCUMENTS_PENDING',
    documents,
  });

  it('Today lists the documents staff still need, and any sent back', async () => {
    await signIn();
    serveApi({
      'GET /caregivers/cg-1': () => ({ status: 200, body: record([{ id: 'd-1', documentType: 'NIC', verificationStatus: 'REJECTED' }]) }),
      'GET /me/shifts': () => ({ status: 200, body: [] }),
    });
    await show(<Today />);
    expect(await screen.findByText(en.portal.checklist.documents.hint)).toBeTruthy();
    expect(screen.getByText(en.portal.documents.rejectedHint)).toBeTruthy();
    expect(screen.getAllByText(/^•/).map((n) => n.props.children[1])).toEqual([en.portal.documents.core.police, en.portal.documents.core.gn]);
    await fireEvent.press(screen.getByRole('button', { name: en.portal.documents.add }));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/documents');
  });

  it('Today asks for missing documents even when none was sent back', async () => {
    await signIn();
    serveApi({
      'GET /caregivers/cg-1': () => ({ status: 200, body: record([{ id: 'd-1', documentType: 'NIC', verificationStatus: 'PENDING' }]) }),
      'GET /me/shifts': () => ({ status: 200, body: [] }),
    });
    await show(<Today />);
    expect(await screen.findByText(en.portal.checklist.documents.hint)).toBeTruthy();
    expect(screen.queryByText(en.portal.documents.rejectedHint)).toBeNull();
    expect(screen.getAllByText(/^•/)).toHaveLength(2);
  });

  it("Today doesn't mention documents once they're all in", async () => {
    await signIn();
    serveApi({
      'GET /caregivers/cg-1': () => ({
        status: 200,
        body: record([
          { id: 'd-1', documentType: 'PASSPORT', verificationStatus: 'VERIFIED' },
          { id: 'd-2', documentType: 'POLICE_CLEARANCE', verificationStatus: 'PENDING' },
          { id: 'd-3', documentType: 'GRAMA_NILADHARI_CERTIFICATE', verificationStatus: 'IN_PROGRESS' },
        ]),
      }),
      'GET /me/shifts': () => ({ status: 200, body: [] }),
    });
    await show(<Today />);
    expect(await screen.findByText('Nimali Perera')).toBeTruthy();
    expect(screen.queryByText(en.portal.checklist.documents.title)).toBeNull();
  });

  it('Me opens Documents', async () => {
    await signIn();
    serveApi({ 'GET /caregivers/cg-1': () => ({ status: 200, body: record([]) }) });
    await show(<Me />);
    await fireEvent.press(screen.getByRole('button', { name: en.portal.nav.documents }));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/documents');
  });
});
