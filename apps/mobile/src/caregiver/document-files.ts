import { Platform } from 'react-native';
import { hasNativeModule } from '@/native';
import { extensionFor, normaliseFile, PICKABLE_TYPES, type PickedFile } from './documents';

type ImagePicker = typeof import('expo-image-picker');
type FileSystem = typeof import('expo-file-system');

/**
 * The phone side of document upload: the camera, the photo library, the file
 * picker, and opening an uploaded document in the phone's own viewer.
 *
 * The camera and photos need expo-image-picker, which only builds made after
 * it was added have; picking and viewing files use expo-file-system, which
 * every build has. Each is checked before it is loaded, so an older build
 * says "not on this version" rather than failing.
 */

export type PickOutcome =
  | { file: PickedFile }
  | { canceled: true }
  | { error: 'cameraDenied' | 'unsupported' | 'failed' };

function imagePicker(): ImagePicker | null {
  if (!hasNativeModule('ExponentImagePicker')) return null;
  try {
    return require('expo-image-picker') as ImagePicker;
  } catch {
    return null;
  }
}

function fileSystem(): FileSystem | null {
  if (!hasNativeModule('FileSystem')) return null;
  try {
    return require('expo-file-system') as FileSystem;
  } catch {
    return null;
  }
}

export const canUsePhotos = () => imagePicker() !== null;

/** The size of a local file, when the picker didn't say. */
function sizeOf(uri: string): number {
  try {
    const fs = fileSystem();
    return fs ? new fs.File(uri).size : 0;
  } catch {
    return 0;
  }
}

/**
 * Photos are compressed (JPEG at 70%) so a 12-megapixel document stays a few
 * megabytes - quick on mobile data, still sharp enough to read. Android offers
 * a free-shaped crop; iOS's crop is always square, which would cut an A4 page,
 * so iPhones skip it.
 */
const PHOTO_OPTIONS = {
  mediaTypes: ['images'] as ['images'],
  quality: 0.7,
  allowsEditing: Platform.OS === 'android',
  exif: false,
};

function fromImageResult(result: Awaited<ReturnType<ImagePicker['launchCameraAsync']>>): PickOutcome {
  if (result.canceled || !result.assets?.length) return { canceled: true };
  const a = result.assets[0];
  return { file: normaliseFile({ uri: a.uri, name: a.fileName, mimeType: a.mimeType, size: a.fileSize ?? sizeOf(a.uri) }) };
}

export async function takePhoto(): Promise<PickOutcome> {
  const picker = imagePicker();
  if (!picker) return { error: 'unsupported' };
  try {
    const { granted } = await picker.requestCameraPermissionsAsync();
    if (!granted) return { error: 'cameraDenied' };
    return fromImageResult(await picker.launchCameraAsync({ ...PHOTO_OPTIONS, cameraType: picker.CameraType.back }));
  } catch {
    return { error: 'failed' };
  }
}

/** From the photo library, through the system's photo picker - no permission needed, and HEIC comes back as JPEG. */
export async function choosePhoto(): Promise<PickOutcome> {
  const picker = imagePicker();
  if (!picker) return { error: 'unsupported' };
  try {
    return fromImageResult(
      await picker.launchImageLibraryAsync({
        ...PHOTO_OPTIONS,
        preferredAssetRepresentationMode: picker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      }),
    );
  } catch {
    return { error: 'failed' };
  }
}

/** A PDF or picture from the phone's files (Downloads, Drive, the Files app). */
export async function chooseFile(): Promise<PickOutcome> {
  const fs = fileSystem();
  if (!fs) return { error: 'unsupported' };
  try {
    const picked = await fs.File.pickFileAsync({ mimeTypes: PICKABLE_TYPES });
    if (picked.canceled || !picked.result) return { canceled: true };
    const f = picked.result;
    return { file: normaliseFile({ uri: f.uri, name: f.name, mimeType: f.type, size: f.size }) };
  } catch {
    return { error: 'failed' };
  }
}

/**
 * Where an opened document is kept while the phone's viewer shows it. Emptied
 * before each one and when the Documents screen closes, so a caregiver's ID
 * doesn't stay on the phone.
 */
const VIEWED = 'viewed-documents';

export function clearViewedDocuments(): void {
  const fs = fileSystem();
  if (!fs) return;
  try {
    const dir = new fs.Directory(fs.Paths.cache, VIEWED);
    if (dir.exists) dir.delete();
  } catch {
    /* nothing to clear */
  }
}

/**
 * Downloads an uploaded document (with the sign-in header the file route
 * needs) and opens it in the phone's viewer. Throws when it can't, so the
 * screen can say so.
 */
export async function openDocument(url: string, headers: Record<string, string>, doc: { id: string; mimeType: string; title: string }): Promise<void> {
  const fs = fileSystem();
  if (!fs) throw new Error('unsupported');
  clearViewedDocuments();
  const dir = new fs.Directory(fs.Paths.cache, VIEWED);
  dir.create({ intermediates: true, idempotent: true });
  const file = await fs.File.downloadFileAsync(url, new fs.File(dir, `document-${doc.id}.${extensionFor(doc.mimeType)}`), { headers, idempotent: true });
  if (!(await fs.File.canPreview(file, { mimeType: doc.mimeType }))) throw new Error('no viewer');
  await fs.File.preview(file, { mimeType: doc.mimeType, title: doc.title });
}
