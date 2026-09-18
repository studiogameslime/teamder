// InAppMessageHost — renders Joryio in-app campaigns.
//
// The SDK delivers a message; drawing it is the app's job. Mount this once,
// high in the tree, and every modal / banner / slide-up campaign has somewhere
// to appear. Without it the SDK still syncs and still reports impressions —
// the message simply never shows, which is a silent failure.
//
// Two message kinds arrive. `native` is structured (title, body, buttons) and
// is rendered here with the app's own look. `html` is a self-contained document
// the campaign author wrote, drawn by HtmlMessageView in a locked-down WebView
// — same document, same CSP and same `joryioBridge` surface as the SDK's own
// web view, so one authored template behaves identically on web and here.
//
// Both are declared to the server as capabilities (services/joryio), because an
// undeclared kind is targeted as "cannot show". Until HtmlMessageView existed,
// an html campaign was logged and dropped: it read as delivered and showed
// nobody anything.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { joryio } from '@/services/joryio';
import { HtmlMessageView } from '@/components/joryio/HtmlMessageView';
import { onboardingService } from '@/services/onboardingService';
import { useUserStore } from '@/store/userStore';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { toast } from '@/components/Toast';
import { he } from '@/i18n/he';
import { colors, radius, spacing, typography } from '@/theme';

type Btn = { id: string; text: string; action: 'dismiss' | 'url' | 'deep_link'; url?: string };
interface HtmlMsg {
  id: string;
  name: string;
  type: 'modal' | 'banner' | 'slideup' | 'fullscreen' | 'custom';
  priority: number;
  kind: 'html';
  html: string;
  css?: string;
}
interface NativeMsg {
  id: string;
  name: string;
  type: 'modal' | 'banner' | 'slideup' | 'fullscreen' | 'custom';
  priority: number;
  kind: 'native';
  title?: string;
  body: string;
  imageUrl?: string;
  buttons: Btn[];
  closeButton: boolean;
  backdropDismissible: boolean;
  style?: {
    backgroundColor?: string;
    textColor?: string;
    primaryButtonColor?: string;
    primaryButtonTextColor?: string;
    cornerRadius?: number;
    fontSize?: number;
    titleWeight?: 'regular' | 'medium' | 'semibold' | 'bold';
    textAlign?: 'auto' | 'start' | 'center' | 'end';
    fontFamily?: string;
  };
}

const WEIGHT = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

type Msg = NativeMsg | HtmlMsg;

export function InAppMessageHost(): React.ReactElement | null {
  const [msg, setMsg] = useState<Msg | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const me = useUserStore((st) => st.currentUser);
  /** Values the document cannot know and cannot fetch: the signed-in person's
   *  own invite link, and their name. Written into the markup by the shim. */
  const [vars, setVars] = useState<Record<string, string>>({});
  /** Set once a submit has actually succeeded — the wizard reaches its finish
   *  screen because something finished, not because a button was pressed. */
  const [advanceTo, setAdvanceTo] = useState<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    const off = joryio.onInAppMessage((raw) => {
      // Read `kind` off the untyped payload: narrowing the union first makes
      // the unknown-kind branch unreachable to the compiler, which is exactly
      // the branch that has to survive a newer SDK than this build.
      const wire = (raw ?? {}) as { kind?: string; id?: string; html?: string };
      // Never drop one silently — the campaign is already counted as delivered
      // by the time it reaches us.
      if (wire.kind !== 'native' && wire.kind !== 'html') {
        if (__DEV__) {
          console.warn('[joryio] in-app message kind not renderable:', wire.kind, wire.id);
        }
        return;
      }
      if (wire.kind === 'html' && !wire.html) return;
      setMsg(raw as Msg);
    });
    // Pull whatever is eligible now; the listener above catches the rest.
    joryio.syncInAppCampaigns();
    return off;
  }, []);

  useEffect(() => {
    if (!msg) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    joryio.trackInAppImpression(msg.id, 'displayed');
  }, [msg, fade]);

  // The SDK classifies an interaction by SUBSTRING — an action containing
  // 'click' becomes a click, one containing 'dismiss' becomes a dismissal, and
  // anything else falls through to a DISPLAY. So the vocabulary here is wire
  // protocol, not a label: 'impression' and 'button:cta' both read as another
  // display, which is how this campaign showed 3 impressions and 0 clicks while
  // every layer underneath worked. Only 'displayed' | 'clicked' | 'dismissed'
  // may be passed to trackInAppImpression.
  const close = useCallback(
    (reason: 'dismissed' | 'clicked') => {
      if (msg) joryio.trackInAppImpression(msg.id, reason);
      setMsg(null);
      setVars({});
      setAdvanceTo(null);
      submittingRef.current = false;
    },
    [msg],
  );

  /**
   * A `data-action="submit"` tap: the wizard has collected what it needs and
   * the app does the part a document cannot.
   *
   * Guarded against a double tap, because the work is a club that would
   * otherwise be created twice. The message is NOT closed either way — on
   * success the shim moves to the finish screen, on failure the person stays
   * on the form with their answers still in it.
   */
  const onSubmit = useCallback(
    async (fields: Record<string, unknown>) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      try {
        const res = await onboardingService.submit(fields);
        if (res.ok) {
          logEvent(AnalyticsEvent.OnboardingCompleted, {
            role: String(fields.role ?? 'organiser'),
            createdClub: !!res.groupId,
          });
          // The link lands BEFORE the step that shows it, so the slot is never
          // seen empty: injecting vars and advancing are two renders, and this
          // one goes first.
          if (res.inviteUrl) {
            setVars({ inviteUrl: res.inviteUrl, userName: me?.name ?? '' });
          }
          setAdvanceTo(res.advanceTo);
          // Cleared so a second submit on the same message can advance again;
          // the prop only fires the injection when it CHANGES.
          submittingRef.current = false;
        } else {
          toast.error(res.message ?? he.error);
          submittingRef.current = false;
        }
      } catch (err) {
        logError('inAppOnboardingSubmit', err, {});
        toast.error(he.error);
        submittingRef.current = false;
      }
    },
    [me?.name],
  );

  /** A `data-action="share"` tap. The sheet comes back and the person is still
   *  mid-flow, so nothing closes. */
  const onShare = useCallback(async () => {
    const url = vars.inviteUrl;
    if (!url) return;
    try {
      const r = await Share.share({
        title: he.inviteShareSubject,
        message: he.profileInviteShareBody(url),
      });
      if (r.action !== 'dismissedAction') {
        logEvent(AnalyticsEvent.InviteShared, { source: 'onboarding' });
      }
    } catch (err) {
      if (__DEV__) console.warn('[inapp] share failed', err);
    }
  }, [vars.inviteUrl]);

  const onButton = useCallback(
    (b: Btn) => {
      if ((b.action === 'url' || b.action === 'deep_link') && b.url) {
        // Both land in the same place: a footy:// deep link and an https invite
        // URL are each handled by the app's existing link routing.
        Linking.openURL(b.url).catch(() => undefined);
      }
      // A button is a click AND a close, and the SDK's own native presenter
      // reports both for the same tap. Report them in that order so CTR counts
      // the tap and the dismissal still closes the delivery.
      if (msg) joryio.trackInAppImpression(msg.id, 'clicked');
      close('dismissed');
    },
    [close, msg],
  );

  if (!msg) return null;

  if (msg.kind === 'html') {
    const full = msg.type === 'fullscreen';
    const banner = msg.type === 'banner' || msg.type === 'slideup';
    return (
      <Modal transparent animationType="none" visible onRequestClose={() => close('dismissed')}>
        <Animated.View
          style={[styles.backdrop, banner && styles.backdropBanner, { opacity: fade }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => close('dismissed')} />
          <View
            style={[
              styles.card,
              styles.cardHtml,
              banner && styles.cardBanner,
              full && styles.cardFull,
            ]}
          >
            <HtmlMessageView
              campaignId={msg.id}
              html={msg.html}
              css={msg.css}
              fullscreen={full}
              onClick={(url) => {
                if (url) Linking.openURL(url).catch(() => undefined);
                if (msg) joryio.trackInAppImpression(msg.id, 'clicked');
                close('dismissed');
              }}
              onClose={() => close('dismissed')}
              onSubmit={onSubmit}
              onShare={onShare}
              vars={vars}
              advanceTo={advanceTo}
            />
            {/* Always ours, never the document's. An html message that forgot a
                close control would otherwise trap the user behind a modal, and
                we cannot inspect author markup to find out whether it has one. */}
            <Pressable onPress={() => close('dismissed')} hitSlop={12} style={styles.close}>
              <Text style={styles.closeTextHtml}>✕</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Modal>
    );
  }

  const s = msg.style ?? {};
  // Absent override = inherit the app's own styling. Never substitute a
  // default of our own for a field the campaign did not set.
  const bg = s.backgroundColor ?? colors.surface;
  const fg = s.textColor ?? colors.text;
  const accent = s.primaryButtonColor ?? colors.primary;
  const accentText = s.primaryButtonTextColor ?? '#fff';
  // typography.body.fontSize is optional in the theme's type, so it cannot be
  // multiplied for the headline without a concrete fallback.
  const bodySize = s.fontSize ?? typography.body.fontSize ?? 15;
  // `auto` aligns by the MESSAGE's language, not the device's — this workspace
  // sends Hebrew and English to the same install, so I18nManager.isRTL is the
  // wrong test. RN's writingDirection:'auto' does it per-string.
  const align =
    s.textAlign === 'center' ? 'center'
      : s.textAlign === 'start' ? 'left'
        : s.textAlign === 'end' ? 'right'
          : 'auto';

  const isBanner = msg.type === 'banner' || msg.type === 'slideup';

  return (
    <Modal transparent animationType="none" visible onRequestClose={() => close('dismissed')}>
      <Animated.View style={[styles.backdrop, isBanner && styles.backdropBanner, { opacity: fade }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => (msg.backdropDismissible ? close('dismissed') : undefined)}
        />
        <View
          style={[
            styles.card,
            isBanner && styles.cardBanner,
            msg.type === 'fullscreen' && styles.cardFull,
            { backgroundColor: bg, borderRadius: s.cornerRadius ?? radius.lg },
          ]}
        >
          {msg.closeButton ? (
            <Pressable onPress={() => close('dismissed')} hitSlop={12} style={styles.close}>
              <Text style={[styles.closeText, { color: fg }]}>✕</Text>
            </Pressable>
          ) : null}

          {msg.title ? (
            <Text
              style={[
                styles.title,
                {
                  color: fg,
                  fontSize: bodySize * 1.35,
                  fontWeight: WEIGHT[s.titleWeight ?? 'bold'],
                  textAlign: align,
                  writingDirection: 'auto',
                  ...(s.fontFamily ? { fontFamily: s.fontFamily } : {}),
                },
              ]}
            >
              {msg.title}
            </Text>
          ) : null}

          <Text
            style={[
              styles.body,
              {
                color: fg,
                fontSize: bodySize,
                textAlign: align,
                writingDirection: 'auto',
                ...(s.fontFamily ? { fontFamily: s.fontFamily } : {}),
              },
            ]}
          >
            {msg.body}
          </Text>

          <View style={styles.buttons}>
            {(msg.buttons ?? []).map((b, i) => (
              <Pressable
                key={b.id}
                onPress={() => onButton(b)}
                style={[
                  styles.btn,
                  i === 0
                    ? { backgroundColor: accent }
                    : { backgroundColor: 'transparent', borderColor: accent, borderWidth: 1 },
                ]}
              >
                <Text
                  style={[
                    styles.btnText,
                    { color: i === 0 ? accentText : accent, writingDirection: 'auto' },
                  ]}
                  numberOfLines={1}
                >
                  {b.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  backdropBanner: { justifyContent: 'flex-end' },
  card: { width: '100%', maxWidth: 420, padding: spacing.lg, gap: spacing.sm },
  cardBanner: { maxWidth: undefined },
  // No padding and no colour: an html message paints its own background right
  // to the edge, and a surface-coloured inset would frame it in the app's
  // theme instead of the author's.
  cardHtml: { padding: 0, gap: 0, overflow: 'hidden', backgroundColor: 'transparent' },
  cardFull: { flex: 1, maxWidth: undefined, justifyContent: 'center' },
  close: { position: 'absolute', top: spacing.sm, left: spacing.sm, zIndex: 2, padding: 4 },
  closeText: { fontSize: 18, fontWeight: '600' },
  // Its own contrast: the document behind it can be any colour, so the glyph
  // rides on a dark disc rather than borrowing a theme token.
  closeTextHtml: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    width: 26,
    height: 26,
    lineHeight: 26,
    textAlign: 'center',
    borderRadius: 13,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  title: { marginTop: spacing.xs },
  body: { lineHeight: 22 },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { ...typography.label, fontWeight: '700' },
});
