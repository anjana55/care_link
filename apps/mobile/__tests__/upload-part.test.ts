import { convertFormDataAsync } from 'expo/src/winter/fetch/convertFormData';
import { uploadPart } from '../src/caregiver/document-files';

/**
 * Document uploads go through Expo's fetch (SDK 58 replaces React Native's).
 * These run Expo's own form encoder on what the app sends: the old
 * { uri, name, type } part is refused before leaving the phone - the
 * "We could not save that" a caregiver saw - and the part the app now sends
 * goes out with the file's bytes, name and type.
 */

jest.mock('../src/native', () => ({ hasNativeModule: () => true }));
const mockRead: string[] = [];
jest.mock('expo-file-system', () => ({
  File: class {
    mockUri: string;
    constructor(mockUri: string) {
      this.mockUri = mockUri;
    }
    async bytes() {
      mockRead.push(this.mockUri);
      return new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    }
  },
}));

// A form as Expo's FormData presents it to the encoder on the phone: its parts, in order.
const formOf = (...parts: [string, unknown][]) => ({ entries: () => parts }) as unknown as FormData;
const encode = async (form: FormData) => {
  const { body, boundary } = await convertFormDataAsync(form, 'BOUNDARY');
  return { text: new TextDecoder('latin1').decode(body), boundary };
};

it("refuses React Native's { uri, name, type } part, as the phone did", async () => {
  const form = formOf(['documentType', 'NIC'], ['file', { uri: 'file:///cache/a.jpg', name: 'a.jpg', type: 'image/jpeg' }]);
  await expect(encode(form)).rejects.toThrow('Unsupported FormDataPart implementation');
});

it('sends the file read from the phone, with the checked name and type', async () => {
  const form = formOf(['documentType', 'NIC'], ['file', uploadPart({ uri: 'file:///cache/ImagePicker/IMG_1.heic', name: 'IMG_1.jpg', mimeType: 'image/jpeg', size: 4 })]);
  const { text } = await encode(form);
  expect(mockRead).toEqual(['file:///cache/ImagePicker/IMG_1.heic']);
  expect(text).toContain('content-disposition: form-data; name="documentType"\r\n\r\nNIC\r\n');
  expect(text).toContain('content-disposition: form-data; name="file"; filename="IMG_1.jpg"\r\ncontent-type: image/jpeg\r\n\r\n\xff\xd8\xff\xe0\r\n');
  expect(text.endsWith('--BOUNDARY--\r\n')).toBe(true);
});

it("still carries the uri, for React Native's own fetch", () => {
  expect(uploadPart({ uri: 'content://docs/7', name: 'police.pdf', mimeType: 'application/pdf', size: 9 })).toMatchObject({
    uri: 'content://docs/7',
    name: 'police.pdf',
    type: 'application/pdf',
  });
});
