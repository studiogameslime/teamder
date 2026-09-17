// roleService — what somebody answered when the app asked why they are here.
//
// The answer arrives as a query parameter on a campaign link
// (`footy://open/create-community?role=organiser`), which is the only channel
// an in-app message has: the document runs under `script-src 'none'`, so a
// button cannot call anything — it can only be a link.

import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { joryio } from '@/services/joryio';
import { logError } from '@/services/errorLog';
import type { UserRole } from '@/utils/appLinks';

/**
 * Written BOTH ways on purpose. The event is the timestamp — it says an answer
 * was given, and it is what a journey can trigger on. The attribute is the
 * state — it is what a campaign can TARGET on, and an event cannot be targeted
 * on months later. Joryio gets no merge fields from us, so anything a future
 * message wants to know has to be on the profile before it is sent.
 *
 * Never throws and never blocks the navigation that follows it: the answer is
 * worth having, and it is not worth a tap that appears to do nothing.
 */
export async function recordRole(role: UserRole): Promise<void> {
  try {
    logEvent(AnalyticsEvent.RoleSelected, { role });
    await joryio.setAttributes({ user_type: role });
  } catch (err) {
    logError('recordRole', err, { role });
  }
}
