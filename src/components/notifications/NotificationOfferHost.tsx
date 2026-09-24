// NotificationOfferHost — where the offer lives, so no business path owns it.
//
// Mounted once, beside `WhatsNewGate` and `CampaignGate`. It listens for
// "somebody just completed X", asks `notificationOffer` whether that earns the
// question, and presents the sheet if it does.
//
// The separation is the point. `actionCoordinator` announces a completed
// action and moves on — it does not know about permissions, does not wait for
// a sheet, and cannot fail because of one. A join that succeeded reports
// success whatever happens here.
//
// ─── The ordering that matters ───────────────────────────────────────────
//
// The announcement fires AFTER the business outcome is terminal and the
// pending action has been cleaned up. So by the time this component hears
// about it, the thing the person asked for has already happened and nothing
// is waiting on their answer.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import {
  NotificationEducationSheet,
  type EducationAction,
} from '@/components/notifications/NotificationEducationSheet';
import {
  setOfferListener,
  shouldOffer,
  markOffered,
  announceCompleted,
  type OfferContext,
} from '@/services/notificationOffer';
import {
  getPushPermissionState,
  openAppSettings,
  type PushPermissionState,
} from '@/services/pushPermission';
import { notificationsService } from '@/services/notificationsService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { useUserStore } from '@/store/userStore';

interface Shown {
  context: OfferContext;
  state: PushPermissionState;
  /** Carried so a stand-down can re-queue the announcement exactly as it
   *  arrived. */
  opts: { applicable?: boolean };
}

export function NotificationOfferHost({ active }: { active: boolean }) {
  const [shown, setShown] = useState<Shown | null>(null);
  // Read at action time rather than subscribed: the sheet does not re-render
  // on sign-in, and the uid it needs is the one present when somebody taps.
  const uidRef = useRef<string | null>(null);
  const currentUid = useUserStore((s) => s.currentUser?.id ?? null);
  const isGuest = useUserStore((s) => s.currentUser?.isGuest === true);
  uidRef.current = currentUid;

  // Guard against a second sheet while one is open, and against the OS dialog
  // returning focus and re-triggering anything. One offer at a time, always.
  const busyRef = useRef(false);
  // `active` as of NOW, not as of when a closure was made. The decision below
  // is async — a permission read and two storage reads — and the emulator
  // caught the gap: "מה חדש" resolved 350ms into that window, the host went
  // inactive, and the decision still landed on screen because it had captured
  // `active: true` on the way in.
  const activeRef = useRef(active);
  activeRef.current = active;

  const offer = useCallback(
    (context: OfferContext, opts: { applicable?: boolean }) => {
      if (!active || busyRef.current) return;
      void (async () => {
        try {
          const decision = await shouldOffer(context, opts);
          if (!decision.show) return;
          // Re-checked AFTER the await. If something else took the screen
          // while we were deciding, re-queue and let it have it — the
          // announcement comes back when this host registers again.
          if (!activeRef.current) {
            announceCompleted(context, opts);
            return;
          }
          busyRef.current = true;
          // NOT marked here. The context is spent when somebody has actually
          // seen the sheet and answered it — see `onAction`. Marking on
          // presentation meant a sheet that had to stand down for another
          // modal could never come back, because its own mark said it had
          // already been asked.
          logEvent(AnalyticsEvent.NotificationEducationShown, {
            context,
            permission_before: decision.state,
            platform: Platform.OS,
          });
          setShown({ context, state: decision.state, opts });
        } catch (err) {
          // An offer that could not be computed is an offer that does not
          // appear. Nothing about the completed action depends on it.
          logError('notificationOfferDecide', err, { context });
        }
      })();
    },
    [active],
  );

  // Registered only while ACTIVE. An inactive host that registered anyway
  // would consume the queued announcement and drop it — which is precisely
  // the race this queue exists to close.
  useEffect(() => {
    if (!active) {
      setOfferListener(null);
      return;
    }
    setOfferListener(offer);
    return () => setOfferListener(null);
  }, [offer, active]);

  const close = useCallback(() => {
    setShown(null);
    busyRef.current = false;
  }, []);

  // ── Standing down ──────────────────────────────────────────────────────
  //
  // Another one-time sheet ("מה חדש") can resolve a beat AFTER this one is
  // already up — the emulator showed both on screen at once, because the join
  // completed ~300ms after sign-in while the What's New payload was still
  // being read. `active` going false is that happening, so this withdraws and
  // re-queues: the announcement is redelivered the moment the host registers
  // again, and nothing is lost.
  const shownRef = useRef<Shown | null>(null);
  shownRef.current = shown;
  useEffect(() => {
    if (active) return;
    const current = shownRef.current;
    if (!current) return;
    setShown(null);
    busyRef.current = false;
    announceCompleted(current.context, current.opts);
  }, [active]);

  const onAction = useCallback(
    (action: EducationAction) => {
      const current = shown;
      if (!current) return;
      // Spent now: they saw it and answered. This is also what writes the
      // shared cooldown, so a "לא עכשיו" holds every other context back.
      void markOffered(current.context);
      logEvent(AnalyticsEvent.NotificationEducationAction, {
        context: current.context,
        action,
        permission_before: current.state,
        platform: Platform.OS,
      });

      // "לא עכשיו" and a dismissal are the same thing to the system: close,
      // raise nothing, navigate nowhere, change nothing. The cooldown written
      // by `markOffered` is what stops it coming straight back.
      if (action === 'not_now' || action === 'dismiss') {
        close();
        return;
      }

      if (action === 'settings') {
        // Only ever from this explicit tap. Opening settings by itself would
        // be the app throwing somebody out of what they were doing.
        close();
        void openAppSettings();
        return;
      }

      // Close BEFORE the OS dialog. Two modals stacked is how the second one
      // silently never appears on iOS, and the sheet has said its piece.
      close();
      void (async () => {
        try {
          const uid = uidRef.current;
          if (!uid) return;
          // The existing prompt-and-register call, unchanged — it already
          // fires `PushPermissionResult`, which is the last step of the funnel
          // and did not need a second event invented for it.
          await notificationsService.requestAndRegisterPushToken(uid);
          // Re-read rather than infer: the person may have answered the OS
          // dialog in a way the return value does not distinguish, and this
          // is what the next context will be judged against.
          await getPushPermissionState();
        } catch (err) {
          logError('notificationOfferRequest', err, { context: current.context });
        }
      })();
    },
    [shown, close],
  );

  // A guest never sees this. Not because of the permission state — because
  // every context here is a completed ACCOUNT action, and a guest reaching one
  // has already become a full account by the time it completes.
  if (!shown || isGuest) return null;

  return (
    <NotificationEducationSheet
      visible
      context={shown.context}
      blocked={shown.state === 'blocked'}
      onAction={onAction}
    />
  );
}
