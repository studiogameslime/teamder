// The existing feedback document accepts a bounded base64 JPEG, not a URL.
export const FEEDBACK_IMAGE_LIMIT = 700_000;
export async function prepareFeedbackImage(source: { uri: string; width?: number; height?: number }): Promise<string> {
  const manipulator: typeof import('expo-image-manipulator') = require('expo-image-manipulator');
  const width = source.width && source.width > 0 ? source.width : 900;
  const height = source.height && source.height > 0 ? source.height : width;
  for (const [edge, quality] of [[1200, 0.58], [900, 0.42], [640, 0.35]]) {
    const scale = Math.min(1, edge / Math.max(width, height));
    const resize = source.width && source.height ? { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) } : { width: edge };
    const result = await manipulator.manipulateAsync(source.uri, [{ resize }], { compress: quality, format: manipulator.SaveFormat.JPEG, base64: true });
    if (result.base64 && result.base64.length < FEEDBACK_IMAGE_LIMIT) return result.base64;
  }
  throw new Error('Feedback image is too large');
}
export async function pickFeedbackImage(): Promise<string | null> {
  const picker: typeof import('expo-image-picker') = require('expo-image-picker');
  // The system photo picker grants access to the chosen image itself; no
  // broad gallery permission is needed (installed Expo picker API).
  const selected = await picker.launchImageLibraryAsync({ mediaTypes: picker.MediaTypeOptions.Images, allowsEditing: false, quality: 1 });
  if (selected.canceled || !selected.assets?.[0]) return null;
  return prepareFeedbackImage(selected.assets[0]);
}
