// Profile photo upload pipeline.
//
// pickAndUploadAvatar() opens the native gallery picker, lets the
// user crop to a square, resizes the result to 512×512 JPEG @ 80%
// quality (≈150 KB), uploads to Firebase Storage at
// /users/{uid}/avatar.jpg, and returns the download URL the caller
// writes to /users/{uid}.photoUrl.
//
// Hard limits we enforce client-side:
//   • aspect 1:1 — circular UI requires square source
//   • max dimension 512 px — kills 5 MB camera shots before upload
//   • JPEG @ 0.8 — visually identical to higher quality at this size
// Storage rules enforce a 5 MB hard cap as a server-side safety net.
//
// Native-module loading: expo-image-picker / expo-image-manipulator
// are required lazily so a dev client built before they were added
// to package.json doesn't crash on import. Missing module → the
// caller gets `{ ok: false, reason: 'unavailable' }` and can show
// a friendly message rather than a redbox.

import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { logError } from '@/services/errorLog';

type ImagePickerModule = typeof import('expo-image-picker');
type ImageManipulatorModule = typeof import('expo-image-manipulator');

function loadNativePickers():
  | { ok: true; ImagePicker: ImagePickerModule; ImageManipulator: ImageManipulatorModule }
  | { ok: false } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ImagePicker: ImagePickerModule = require('expo-image-picker');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ImageManipulator: ImageManipulatorModule = require('expo-image-manipulator');
    // The JS module loads even when the native side isn't linked,
    // but the methods themselves come back undefined. Check the
    // entry points we actually call so we fail BEFORE hitting an
    // unhandled "Cannot read property X of undefined" deep in the
    // upload pipeline.
    if (
      typeof ImagePicker?.requestMediaLibraryPermissionsAsync !== 'function' ||
      typeof ImagePicker?.launchImageLibraryAsync !== 'function' ||
      typeof ImageManipulator?.manipulateAsync !== 'function'
    ) {
      if (__DEV__) {
        console.warn(
          '[photoService] native picker JS loaded but native bindings missing — rebuild the dev client',
        );
      }
      return { ok: false };
    }
    return { ok: true, ImagePicker, ImageManipulator };
  } catch (err) {
    if (__DEV__) {
      console.warn(
        '[photoService] native picker module not linked — rebuild the dev client',
        err,
      );
    }
    return { ok: false };
  }
}

const AVATAR_PATH = (uid: string) => `users/${uid}/avatar.jpg`;
const TARGET_SIZE = 512;
const JPEG_QUALITY = 0.8;

// Community cover: landscape hero behind the title on the community
// details screen. Stored at /groups/{groupId}/cover.jpg by the
// `uploadGroupCover` callable (server-side Admin SDK write). Wider + a
// touch lower quality than the avatar since it's a background, not a
// focal photo — 1280×720 @ 0.7 lands ≈250 KB.
const COVER_WIDTH = 1280;
const COVER_HEIGHT = 720;
const COVER_QUALITY = 0.7;

/** Generic outcome wrapper so callers don't have to try/catch each step. */
export type PhotoUploadResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: 'cancelled' | 'permission' | 'network' | 'unavailable' | 'unknown';
      err?: unknown;
    };

/**
 * Show the OS picker, let the user crop, then upload + return the
 * download URL. Caller writes it to /users/{uid}.photoUrl.
 */
export async function pickAndUploadAvatar(
  uid: string,
): Promise<PhotoUploadResult> {
  if (!uid) return { ok: false, reason: 'unknown' };
  if (USE_MOCK_DATA) {
    // Mock mode: there's no Storage to upload to. We synthesize a
    // local URI so screen state can show "you picked a photo" — the
    // value never round-trips to a real backend.
    return { ok: false, reason: 'unknown' };
  }

  const native = loadNativePickers();
  if (!native.ok) {
    return { ok: false, reason: 'unavailable' };
  }
  const { ImagePicker, ImageManipulator } = native;

  // Steps 1–3 hit native picker/manipulator bindings that can throw
  // (OS denial races, cancelled crop sessions, OOM on huge sources).
  // The function is typed to return a PhotoUploadResult — callers never
  // expect a throw — so guard the native pipeline and surface the
  // failure as a result instead of an unhandled rejection.
  let sourceUri: string;
  let resized: { uri: string };
  try {
    // 1) Permission. iOS / Android both prompt the user the first
    //    time; subsequent calls return the cached decision.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      return { ok: false, reason: 'permission' };
    }

    // 2) Pick + crop. allowsEditing=true on iOS surfaces the OS-level
    //    crop UI; on Android it brings up a system cropper. aspect
    //    forces square so the circular UI has clean source pixels.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (picked.canceled || !picked.assets?.[0]) {
      return { ok: false, reason: 'cancelled' };
    }
    sourceUri = picked.assets[0].uri;

    // 3) Resize + compress. Lands ≤ ~150 KB JPEG even from a 12 MP
    //    source, which keeps Storage bandwidth bills tiny.
    resized = await ImageManipulator.manipulateAsync(
      sourceUri,
      [{ resize: { width: TARGET_SIZE, height: TARGET_SIZE } }],
      { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
    );
  } catch (err) {
    logError('pickAndUploadAvatar', err, { uid });
    return { ok: false, reason: 'unknown', err };
  }

  // 4) Upload. fetch() the local file URL → Blob → uploadBytes
  //    is the standard RN+Firebase Storage idiom (the SDK doesn't
  //    accept a file URI directly).
  let blob: Blob;
  try {
    const res = await fetch(resized.uri);
    blob = await res.blob();
  } catch (err) {
    logError('uploadAvatar', err, { reason: 'network' });
    return { ok: false, reason: 'network', err };
  }

  try {
    const { storage } = getFirebase();
    const path = AVATAR_PATH(uid);
    const objectRef = storageRef(storage, path);
    await uploadBytes(objectRef, blob, { contentType: 'image/jpeg' });
    const url = await getDownloadURL(objectRef);
    return { ok: true, url };
  } catch (err) {
    logError('uploadAvatar', err, { reason: 'network' });
    return { ok: false, reason: 'network', err };
  }
}

/**
 * Show the OS picker (cropped to 16:9), then upload the result as the
 * community cover and return the download URL. Caller writes it to
 * /groups/{groupId}.coverPhotoUrl via groupService.updateGroupMetadata.
 * The storage rule only lets coaches of {groupId} write, so a
 * non-admin upload fails with reason 'network'.
 */
export async function pickAndUploadGroupCover(
  groupId: string,
): Promise<PhotoUploadResult> {
  if (!groupId) return { ok: false, reason: 'unknown' };
  if (USE_MOCK_DATA) {
    return { ok: false, reason: 'unknown' };
  }

  const native = loadNativePickers();
  if (!native.ok) {
    return { ok: false, reason: 'unavailable' };
  }
  const { ImagePicker, ImageManipulator } = native;

  // Guard the native picker/manipulator pipeline — same rationale as
  // pickAndUploadAvatar: this returns a PhotoUploadResult, so a native
  // throw must become a result, not an unhandled rejection.
  let resized: { base64?: string };
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      return { ok: false, reason: 'permission' };
    }

    // 16:9 crop matches the hero's landscape framing.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 1,
    });
    if (picked.canceled || !picked.assets?.[0]) {
      return { ok: false, reason: 'cancelled' };
    }
    const sourceUri = picked.assets[0].uri;

    resized = await ImageManipulator.manipulateAsync(
      sourceUri,
      [{ resize: { width: COVER_WIDTH, height: COVER_HEIGHT } }],
      {
        compress: COVER_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );
  } catch (err) {
    logError('pickAndUploadGroupCover', err, { groupId });
    return { ok: false, reason: 'unknown', err };
  }
  const imageBase64 = resized.base64;
  if (!imageBase64) {
    return { ok: false, reason: 'unknown' };
  }

  // Upload through the `uploadGroupCover` callable rather than a direct
  // client Storage write. The Storage rule for this path admin-gated via
  // `firestore.get(...).adminIds`, but that cross-service read carries no
  // App Check token and the project enforces App Check on Firestore — so
  // direct writes failed with `storage/unauthorized` for everyone. The
  // callable verifies the admin and writes with the Admin SDK.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const { functions } = getFirebase();
    const fn = httpsCallable(functions, 'uploadGroupCover');
    const res = (await fn({
      groupId,
      imageBase64,
      contentType: 'image/jpeg',
    })) as { data?: { url?: string } };
    const url = res?.data?.url;
    if (!url) return { ok: false, reason: 'network' };
    return { ok: true, url };
  } catch (err) {
    logError('uploadGroupCover', err, { groupId });
    return { ok: false, reason: 'network', err };
  }
}

/**
 * Best-effort delete of a previously-uploaded avatar. Called when
 * the user switches to a built-in avatar (so we don't leave their
 * old photo orphaned in Storage). Silently no-ops on failure — the
 * orphan is harmless and the next upload overwrites it.
 */
export async function deleteUserPhoto(uid: string): Promise<void> {
  if (!uid || USE_MOCK_DATA) return;
  try {
    const { storage } = getFirebase();
    await deleteObject(storageRef(storage, AVATAR_PATH(uid)));
  } catch (err) {
    logError('deleteUserPhoto', err, { uid });
    // 404 / permission-denied / network — all acceptable.
  }
}
