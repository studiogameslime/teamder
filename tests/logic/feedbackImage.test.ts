jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-image-picker', () => ({ requestMediaLibraryPermissionsAsync: jest.fn(), launchImageLibraryAsync: jest.fn(), MediaTypeOptions: { Images: 'images' } }));
import { manipulateAsync } from 'expo-image-manipulator';
import { launchImageLibraryAsync, requestMediaLibraryPermissionsAsync } from 'expo-image-picker';
import { FEEDBACK_IMAGE_LIMIT, pickFeedbackImage, prepareFeedbackImage } from '@/services/feedbackImage';
beforeEach(() => jest.resetAllMocks());
test('a portrait screenshot keeps its aspect ratio and becomes the bounded JPEG payload', async () => {
  (manipulateAsync as jest.Mock).mockResolvedValue({ base64: 'jpeg-data' });
  expect(await prepareFeedbackImage({ uri: 'file://shot', width: 1080, height: 2400 })).toBe('jpeg-data');
  expect(manipulateAsync).toHaveBeenCalledWith('file://shot', [{ resize: { width: 540, height: 1200 } }], expect.objectContaining({ base64: true, format: 'jpeg' }));
});
test('annotation with unknown dimensions never forces a square', async () => {
  (manipulateAsync as jest.Mock).mockResolvedValue({ base64: 'jpeg-data' });
  await prepareFeedbackImage({ uri: 'data:image/jpeg;base64,test' });
  expect((manipulateAsync as jest.Mock).mock.calls[0][1]).toEqual([{ resize: { width: 1200 } }]);
});
test('large images retry compression and never silently disappear from a report', async () => {
  const large = 'x'.repeat(FEEDBACK_IMAGE_LIMIT);
  (manipulateAsync as jest.Mock).mockResolvedValueOnce({ base64: large }).mockResolvedValueOnce({ base64: 'smaller' });
  expect(await prepareFeedbackImage({ uri: 'file://large' })).toBe('smaller');
  (manipulateAsync as jest.Mock).mockResolvedValue({ base64: large });
  await expect(prepareFeedbackImage({ uri: 'file://large' })).rejects.toThrow('too large');
});
test('cancellation keeps the attachment and the system picker does not request broad gallery access', async () => {
  (launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({ canceled: true });
  expect(await pickFeedbackImage()).toBeNull(); expect(manipulateAsync).not.toHaveBeenCalled();
  expect(requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  (launchImageLibraryAsync as jest.Mock).mockRejectedValueOnce(new Error('Photo access denied'));
  await expect(pickFeedbackImage()).rejects.toThrow('denied');
  expect(launchImageLibraryAsync).toHaveBeenCalledTimes(2);
});
