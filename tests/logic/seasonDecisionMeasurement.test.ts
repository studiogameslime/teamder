import { seasonService } from '../../src/services/seasonService';
import { logEvent } from '../../src/services/analyticsService';
import { httpsCallable } from '../../src/services/diagnosticCallable';

jest.mock('../../src/services/analyticsService', () => ({ logEvent: jest.fn(), AnalyticsEvent: {
  SeasonCloseDeferred: 'deferred', SeasonEndedEarly: 'closed', SeasonsDisabled: 'disabled', SeasonResumeRequested: 'resume_attempt',
} }));
jest.mock('../../src/firebase/config', () => ({ getFirebase: () => ({ functions: {} }) }));
jest.mock('../../src/firebase/authRace', () => ({ withAuthRaceRetry: (run: () => unknown) => run() }));
jest.mock('../../src/services/diagnosticCallable', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../src/services/errorLog', () => ({ logError: jest.fn() }));

test('closing or disabling a season distinguishes waiting, completion, missing evidence and failure', async () => {
  const send = jest.fn();
  (httpsCallable as jest.Mock).mockReturnValue(send);
  for (const operation of ['endNow', 'disable'] as const) {
    for (const data of [{ closedNo: 2, waiting: true }, { closedNo: 2, waiting: false }, { ok: true }]) {
      send.mockResolvedValueOnce({ data });
      await seasonService[operation]('club');
    }
    send.mockRejectedValueOnce(new Error('offline'));
    await expect(seasonService[operation]('club')).rejects.toThrow();
  }
  send.mockRejectedValueOnce(new Error('offline'));
  await expect(seasonService.resume('club')).rejects.toThrow();
  expect((logEvent as jest.Mock).mock.calls.map(([event]) => event)).toEqual(['deferred', 'closed', 'deferred', 'disabled', 'resume_attempt']);
});
