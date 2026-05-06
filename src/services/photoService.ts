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

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';

const AVATAR_PATH = (uid: string) => `users/${uid}/avatar.jpg`;
const TARGET_SIZE = 512;
const JPEG_QUALITY = 0.8;

/** Generic outcome wrapper so callers don't have to try/catch each step. */
export type PhotoUploadResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'cancelled' | 'permission' | 'network' | 'unknown'; err?: unknown };

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
  const sourceUri = picked.assets[0].uri;

  // 3) Resize + compress. Lands ≤ ~150 KB JPEG even from a 12 MP
  //    source, which keeps Storage bandwidth bills tiny.
  const resized = await ImageManipulator.manipulateAsync(
    sourceUri,
    [{ resize: { width: TARGET_SIZE, height: TARGET_SIZE } }],
    { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );

  // 4) Upload. fetch() the local file URL → Blob → uploadBytes
  //    is the standard RN+Firebase Storage idiom (the SDK doesn't
  //    accept a file URI directly).
  let blob: Blob;
  try {
    const res = await fetch(resized.uri);
    blob = await res.blob();
  } catch (err) {
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
  } catch {
    // 404 / permission-denied / network — all acceptable.
  }
}
