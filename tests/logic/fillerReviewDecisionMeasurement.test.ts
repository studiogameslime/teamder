import { decideFiller } from '../../src/services/fillerReview';
import { logEvent, AnalyticsEvent } from '../../src/services/analyticsService';
import { httpsCallable } from '../../src/services/diagnosticCallable';
import { handleFillerOpportunityAction, handleGameReminderAction } from '../../src/services/notificationActionService';
import { gameService } from '../../src/services/gameService';

jest.mock('../../src/firebase/config', () => ({ getFirebase: () => ({ functions: {} }) }));
jest.mock('../../src/firebase/auth', () => ({ waitForAuthRestore: async () => ({ uid: 'member', isAnonymous: false }) }));
jest.mock('../../src/services/gameService', () => ({ gameService: { requestJoinGame: jest.fn(), cancelGameV2: jest.fn() } }));
jest.mock('../../src/services/errorLog', () => ({ logError: jest.fn() }));
jest.mock('expo-notifications', () => ({ scheduleNotificationAsync: jest.fn() }));
jest.mock('../../src/services/diagnosticCallable', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../src/services/analyticsService', () => ({
  logEvent: jest.fn(), AnalyticsEvent: { FillerReviewDecided: 'filler_review_decided', FillerInterestExpressed: 'filler_interest_expressed' },
}));

test('only an actual filler decision contributes a manager action, including a waitlist place', async () => {
  const send = jest.fn();
  (httpsCallable as jest.Mock).mockReturnValue(send);
  const review = (approve: boolean) => decideFiller('round-private', 'candidate-private', approve);
  for (const bucket of ['players', 'waitlist']) {
    send.mockResolvedValueOnce({ data: { bucket } });
    await review(true);
  }
  send.mockResolvedValueOnce({ data: { declined: true } });
  await review(false);
  send.mockResolvedValueOnce({ data: { alreadyHandled: true } });
  await review(true);
  send.mockResolvedValueOnce({ data: { declined: false } });
  await review(false);
  send.mockResolvedValueOnce({ data: { ok: true } }); // Old server, no proof.
  await review(false);
  send.mockRejectedValueOnce(new Error('offline'));
  await expect(review(true)).rejects.toThrow('offline');
  expect(logEvent).toHaveBeenCalledTimes(3);
  expect((logEvent as jest.Mock).mock.calls).toEqual([
    [AnalyticsEvent.FillerReviewDecided, { decision: 'approved', bucket: 'players' }],
    [AnalyticsEvent.FillerReviewDecided, { decision: 'approved', bucket: 'waitlist' }],
    [AnalyticsEvent.FillerReviewDecided, { decision: 'declined' }],
  ]);
});

test('a reminder delegates registration once; a new filler application is not a completed registration', async () => {
  jest.clearAllMocks();
  (gameService.requestJoinGame as jest.Mock).mockResolvedValue({ bucket: 'waitlist' });
  await handleGameReminderAction('JOIN_GAME', 'round');
  expect(gameService.requestJoinGame).toHaveBeenCalledWith('round', 'member', 'notification');
  expect(logEvent).not.toHaveBeenCalled();
  const send = jest.fn();
  (httpsCallable as jest.Mock).mockReturnValue(send);
  for (const data of [{ alreadyPending: false }, { alreadyPending: true }, { ok: true }]) {
    send.mockResolvedValueOnce({ data });
    await handleFillerOpportunityAction('EXPRESS_FILLER_INTEREST', 'round', 'notification');
  }
  expect(logEvent).toHaveBeenCalledTimes(1);
  expect(logEvent).toHaveBeenCalledWith(AnalyticsEvent.FillerInterestExpressed, expect.objectContaining({ source: 'filler_push' }));
});
