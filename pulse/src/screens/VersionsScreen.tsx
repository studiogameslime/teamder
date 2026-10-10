// "גרסאות" — one place to see which version is live in each store, since
// when, and what was fixed/added there; what's done and waiting for the next
// version; and a button to ship the next one. Live store states come from the
// App Store / Google Play APIs; the friendly per-version changelog comes from
// the release log in the DB (appConfig/releaseLog).

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, RefreshControl, Image, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card } from '../components/ui';
import { colors, radius } from '../theme';
import { fetchAppleVersions, type StoreVersion } from '../services/appStoreConnect';
import { fetchPlayProductionRelease, type PlayRelease } from '../services/googlePlay';
import {
  fetchReleaseLog, fetchReleaseShot, appleStateHe, playStatusHe,
  itemsForVersion, itemsByArea, dateHe, durationHe, PENDING,
  type ReleaseLog, type ReleaseItem, type StatusHe,
} from '../services/releaseLog';

import { fetchWearRelease, WEAR_STATUS_HE, type WearRelease } from '../services/wearRelease';

const shotUri = (b64: string) => `data:image/jpeg;base64,${b64}`;

interface StoreLine {
  store?: 'apple' | 'google' | 'wear';
  version: string;
  status: StatusHe;
  since?: number;
  // Going-up lines carry their changelog; live lines leave these empty.
  items?: ReleaseItem[];
  itemsCaption?: string;
}

// Semver-ish compare: >0 when a is newer than b. Used to hide historical
// versions (anything at or below what's already live in every store).
function cmpVer(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function VersionsScreen() {
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState<ReleaseLog>({ items: [], versions: {} });
  const [apple, setApple] = useState<StoreVersion[]>([]);
  const [play, setPlay] = useState<PlayRelease | null>(null);
  const [wear, setWear] = useState<WearRelease | null>(null);

  const load = useCallback(async () => {
    const [a, p, l, w] = await Promise.all([
      fetchAppleVersions().catch(() => [] as StoreVersion[]),
      fetchPlayProductionRelease().catch(() => null),
      fetchReleaseLog().catch(() => ({ items: [], versions: {} } as ReleaseLog)),
      fetchWearRelease().catch(() => null),
    ]);
    setApple(a); setPlay(p); setLog(l); setWear(w);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const since = (v: string) => log.versions[v]?.releasedAt;

  // ── Apple: split into live / in-review / awaiting-release ──
  const appleLive = apple.find((v) => appleStateHe(v.state).live);
  const appleReview = apple.find((v) => appleStateHe(v.state).inReview);
  const applePending = apple.find((v) => v.state === 'PENDING_DEVELOPER_RELEASE');

  // ── Google: live from API, fall back to the newest dated version in the DB ──
  let googleLive: StoreLine | undefined;
  let googleReview: StoreLine | undefined;
  if (play) {
    const st = playStatusHe(play.status);
    // A freshly-submitted production release reads as "completed" in the Play
    // API even while it's still in Google review. If its version is NEWER than
    // the Apple live version, it's the one GOING UP — not the current live.
    const reallyLive = st.live && (!appleLive || play.name === appleLive.version);
    const line: StoreLine = {
      store: 'google',
      version: play.name,
      status: reallyLive
        ? st
        : { he: 'ממתין לאישור', live: false, inReview: true },
      since: reallyLive ? since(play.name) : log.versions[play.name]?.submittedAt,
    };
    if (reallyLive) googleLive = line; else googleReview = line;
  } else {
    const dated = Object.entries(log.versions)
      .filter(([, m]) => m.releasedAt)
      .sort((a, b) => (b[1].releasedAt ?? 0) - (a[1].releasedAt ?? 0))[0];
    if (dated) {
      googleLive = { store: 'google', version: dated[0], status: { he: 'באוויר', live: true, inReview: false }, since: dated[1].releasedAt };
    }
  }

  // ── באוויר עכשיו: the one live version per surface (iOS / Android / שעון) ──
  const liveLines: StoreLine[] = [];
  if (appleLive) liveLines.push({ store: 'apple', version: appleLive.version, status: appleStateHe(appleLive.state), since: since(appleLive.version) });
  if (googleLive) liveLines.push(googleLive);
  const wearLive = wear && WEAR_STATUS_HE[wear.status].live;
  if (wear && wearLive) liveLines.push({ store: 'wear', version: wear.version, status: { he: WEAR_STATUS_HE[wear.status].he, live: true, inReview: false }, since: wear.releasedAt ?? wear.submittedAt });

  // Highest version already live anywhere — the cutoff for "history". Anything
  // at or below this is the past and isn't shown; only newer = going up.
  const maxLive = liveLines.reduce((mx, l) => (cmpVer(l.version, mx) > 0 ? l.version : mx), '0.0.0');

  // For an in-review version, "since" = when it entered review: the submitted
  // date we recorded in the DB, else Apple's version-created date.
  const reviewSince = (v: string, apiCreated?: string) =>
    log.versions[v]?.submittedAt ?? (apiCreated ? Date.parse(apiCreated) : undefined);

  // ── עולה עכשיו: what's in flight to the stores + its changelog ──
  const goingUp: StoreLine[] = [];
  if (appleReview) goingUp.push({ store: 'apple', version: appleReview.version, status: appleStateHe(appleReview.state), since: reviewSince(appleReview.version, appleReview.createdAt), items: itemsForVersion(log, appleReview.version), itemsCaption: 'מה יעלה כשהגרסה תאושר:' });
  if (applePending) goingUp.push({ store: 'apple', version: applePending.version, status: appleStateHe(applePending.state), since: reviewSince(applePending.version, applePending.createdAt), items: itemsForVersion(log, applePending.version), itemsCaption: 'מה יעלה כשהגרסה תאושר:' });
  if (googleReview) goingUp.push({ ...googleReview, items: itemsForVersion(log, googleReview.version), itemsCaption: 'מה יעלה כשהגרסה תאושר:' });
  if (wear && !wearLive) goingUp.push({ store: 'wear', version: wear.version, status: { he: WEAR_STATUS_HE[wear.status].he, live: false, inReview: true }, since: wear.submittedAt ?? wear.releasedAt, items: wear.items.map((it) => ({ ...it, version: wear.version })), itemsCaption: 'מה חדש בשעון:' });

  // Catch the gap window: a version submitted to a store that the store API
  // hasn't reflected yet. Only versions NEWER than everything already live can
  // be "going up" — this keeps history out while a fresh submission stays
  // visible until the store API catches up.
  //
  // Derived from the ITEMS, not from the `versions` map. The map is written by
  // hand on each ship and drifts: it once held a single stale entry, so a
  // version with a full changelog was invisible unless a store API happened to
  // name it — and on a build with no store credentials that meant an empty
  // screen. A version that has changes logged against it exists, whether or not
  // anyone remembered to date it; the map now only supplies the date.
  const shownVersions = new Set([...liveLines, ...goingUp].map((l) => l.version));
  const loggedVersions = [...new Set(log.items.map((i) => i.version))]
    .filter((v) => v !== PENDING && !shownVersions.has(v) && cmpVer(v, maxLive) > 0)
    .sort((a, b) => cmpVer(b, a));
  // With nothing known to be live (no store answered AND no dated release in
  // the DB) every version in history sorts as "newer", so show only the newest
  // rather than replaying the whole changelog as if it were shipping.
  const upVersions = maxLive === '0.0.0' ? loggedVersions.slice(0, 1) : loggedVersions;
  upVersions.forEach((v) =>
    goingUp.push({
      version: v,
      status: { he: 'ממתין לאישור החנויות', live: false, inReview: true },
      since: log.versions[v]?.submittedAt,
      items: itemsForVersion(log, v),
      itemsCaption: 'מה יעלה בגרסה זו:',
    }),
  );

  // Done, built into nothing yet — everything logged between ships.
  const pending = itemsForVersion(log, PENDING);

  // ── גרסאות קודמות ──
  // The three sections above answer "what is happening right now", and to do
  // that they hide everything at or below the live version. That left the
  // changelog unreachable: with 1.1.27 live, every change logged against
  // 1.1.7…1.1.26 sat in the DB and appeared nowhere on this screen — the live
  // row showed its own list and the rest of history was gone. But "what was
  // fixed in the version I'm testing" is the question this screen exists to
  // answer, and the version being tested is usually not the newest one. So
  // the past gets a section of its own: every version that has a changelog
  // and is not already on screen, newest first, collapsed.
  const onScreen = new Set([...liveLines, ...goingUp].map((l) => l.version));
  const history = [...new Set(log.items.map((i) => i.version))]
    .filter((v) => v !== PENDING && !onScreen.has(v))
    .sort((a, b) => cmpVer(b, a));
  // A version nothing was ever logged against opens to an empty card. The
  // count badge was meant to make that honest, but four rows that cannot be
  // opened sitting inside twenty that can is just clutter — and "no record"
  // is a fact about our logging, not about the release. Versions with no
  // changelog are left out of the list; they keep their date in the map.
  const historyWithItems = history.filter((v) => itemsForVersion(log, v).length > 0);

  if (loading) {
    return (
      <Screen title="גרסאות" subtitle="מה באוויר, מה בבדיקה, ומה מחכה">
        <View style={{ paddingVertical: 60 }}><ActivityIndicator color={colors.primary} /></View>
      </Screen>
    );
  }

  return (
    <Screen
      title="גרסאות"
      subtitle="מה באוויר, מה בבדיקה, ומה מחכה לגרסה הבאה"
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
    >
      {/* באוויר עכשיו — name, status, AND what shipped in it. The changelog
          used to be withheld here on the theory that the live version is "a
          known quantity"; it isn't. It is the version everyone is actually
          running, so it is the one people ask about — and with the answer
          missing, the only way to see what a user has was to read the version
          going up and subtract. Collapsed by default so the page stays short:
          the version in flight is still the one that opens on its own. */}
      <Text style={s.section}>באוויר עכשיו</Text>
      {liveLines.length === 0 ? (
        <Card><Text style={s.empty}>אין מידע על גרסה באוויר כרגע</Text></Card>
      ) : (
        liveLines.map((l) => (
          <VersionRow
            key={`live-${l.store}`}
            badge={<StoreBadge store={l.store!} />}
            title={`גרסה ${l.version}`}
            statusText={`${l.status.he}${l.status.live && l.since ? ` · מאז ${dateHe(l.since)}` : ''}`}
            tint={colors.green}
            items={itemsForVersion(log, l.version)}
            itemsCaption="מה נכנס בגרסה הזו:"
          />
        ))
      )}

      {/* עולה עכשיו — what's in flight to the stores, expanded with its changes. */}
      {goingUp.length > 0 ? (
        <>
          <Text style={s.section}>עולה עכשיו</Text>
          {goingUp.map((l) => (
            <VersionRow
              key={`up-${l.store ?? 'db'}-${l.version}`}
              badge={
                l.store ? (
                  <StoreBadge store={l.store} />
                ) : (
                  <View style={[s.badge, { backgroundColor: colors.amber + '22' }]}>
                    <Ionicons name="cloud-upload" size={14} color={colors.amber} />
                    <Text style={[s.badgeTxt, { color: colors.amber }]}>הוגש</Text>
                  </View>
                )
              }
              title={`גרסה ${l.version}`}
              statusText={`${l.status.he}${l.status.inReview && l.since ? ` · כבר ${durationHe(l.since)} בבדיקה` : ''}`}
              tint={colors.amber}
              items={l.items ?? []}
              itemsCaption={l.itemsCaption}
              defaultOpen
            />
          ))}
        </>
      ) : null}

      {/* מחכה לגרסה הבאה — the `next` bucket. The subtitle has promised this
          section since the screen was written and nothing ever rendered it, so
          every fix logged between two ships was invisible here: the log filled
          up, the screen stayed empty, and the natural read was "Pulse is
          broken". */}
      {pending.length > 0 ? (
        <>
          <Text style={s.section}>מחכה לגרסה הבאה</Text>
          <VersionRow
            badge={
              <View style={[s.badge, { backgroundColor: colors.primary + '22' }]}>
                <Ionicons name="time-outline" size={14} color={colors.primary} />
                <Text style={[s.badgeTxt, { color: colors.primary }]}>מוכן</Text>
              </View>
            }
            title={`${pending.length} שינויים מוכנים`}
            statusText="נכנס לגרסה הבאה שתיבנה"
            tint={colors.primary}
            items={pending}
            itemsCaption="מה מחכה:"
          />
        </>
      ) : null}

      {/* גרסאות קודמות — the browsable past. Collapsed, with the count on the
          badge so a version with nothing logged is visible as exactly that
          rather than looking like a version with nothing in it. */}
      {historyWithItems.length > 0 ? (
        <>
          <Text style={s.section}>גרסאות קודמות</Text>
          {historyWithItems.map((v) => {
            const its = itemsForVersion(log, v);
            const when = log.versions[v]?.releasedAt ?? log.versions[v]?.submittedAt;
            return (
              <VersionRow
                key={`hist-${v}`}
                badge={
                  <View style={[s.badge, { backgroundColor: colors.textMuted + '22' }]}>
                    <Ionicons name="pricetag-outline" size={13} color={colors.textMuted} />
                    <Text style={[s.badgeTxt, { color: colors.textMuted }]}>{its.length}</Text>
                  </View>
                }
                title={`גרסה ${v}`}
                statusText={when ? `יצאה ${dateHe(when)}` : 'ללא תאריך'}
                tint={colors.textMuted}
                items={its}
                itemsCaption="מה נכנס בגרסה הזו:"
              />
            );
          })}
        </>
      ) : null}

    </Screen>
  );
}

function StoreBadge({ store }: { store: 'apple' | 'google' | 'wear' }) {
  const meta =
    store === 'apple'
      ? { color: colors.appstore, icon: 'logo-apple' as const, label: 'אפל' }
      : store === 'google'
        ? { color: colors.googleplay, icon: 'logo-google' as const, label: 'גוגל' }
        : { color: '#0EA5E9', icon: 'watch' as const, label: 'שעון' };
  return (
    <View style={[s.badge, { backgroundColor: meta.color + '22' }]}>
      <Ionicons name={meta.icon} size={14} color={meta.color} />
      <Text style={[s.badgeTxt, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

// One collapsible version card. Header (badge + version + status) is always
// shown; the changelog is tucked behind a chevron so the page stays short.
// `defaultOpen` opens the changelog on mount (used for the version going up).
function VersionRow({
  badge,
  title,
  statusText,
  tint,
  items,
  itemsCaption = 'מה חדש בגרסה זו:',
  defaultOpen = false,
}: {
  badge: React.ReactNode;
  title: string;
  statusText: string;
  tint: string;
  items: ReleaseItem[];
  itemsCaption?: string;
  defaultOpen?: boolean;
}) {
  const hasItems = items.length > 0;
  const [open, setOpen] = useState(defaultOpen && hasItems);
  return (
    <Card style={s.vCard}>
      <Pressable
        style={s.vHead}
        onPress={() => hasItems && setOpen((o) => !o)}
        disabled={!hasItems}
      >
        {badge}
        <View style={{ flex: 1 }}>
          <Text style={s.vTitle}>{title}</Text>
          <Text style={[s.vStatus, { color: tint }]}>{statusText}</Text>
        </View>
        {hasItems ? (
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textMuted}
          />
        ) : null}
        <View style={[s.dot, { backgroundColor: tint }]} />
      </Pressable>
      {open && hasItems ? (
        <View style={s.items}>
          <Text style={s.itemsCap}>{itemsCaption}</Text>
          <AreaGroups items={items} />
        </View>
      ) : null}
    </Card>
  );
}

// Renders a list of items grouped under their area (screen/topic) headers.
function AreaGroups({ items }: { items: ReleaseItem[] }) {
  const groups = itemsByArea(items);
  // A single "כללי" bucket = nothing meaningful to group by → flat list.
  if (groups.length === 1 && groups[0].area === 'כללי') {
    return <>{groups[0].items.map((it, i) => <ItemRow key={i} item={it} />)}</>;
  }
  return (
    <>
      {groups.map((g) => (
        <View key={g.area} style={s.areaBlock}>
          <Text style={s.areaLabel}>{g.area}</Text>
          {g.items.map((it, i) => <ItemRow key={i} item={it} />)}
        </View>
      ))}
    </>
  );
}

function ItemRow({ item }: { item: ReleaseItem }) {
  const feature = item.kind === 'feature';
  // Lazy-load the proof screenshot (base64) only when the item carries one.
  const [b64, setB64] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!item.shotId) return;
    let alive = true;
    fetchReleaseShot(item.shotId)
      .then((v) => alive && setB64(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [item.shotId]);

  return (
    <View style={s.itemWrap}>
      <View style={s.itemRow}>
        <Ionicons name={feature ? 'sparkles' : 'checkmark-circle'} size={16} color={feature ? colors.primary : colors.green} />
        <Text style={s.itemTxt}>{item.title}</Text>
      </View>

      {item.shotId ? (
        b64 ? (
          <Pressable style={s.shotThumbWrap} onPress={() => setZoom(true)}>
            <Image source={{ uri: shotUri(b64) }} style={s.shotThumb} resizeMode="cover" />
            <View style={s.shotZoomHint}>
              <Ionicons name="expand-outline" size={13} color="#fff" />
              <Text style={s.shotZoomTxt}>הגדל</Text>
            </View>
          </Pressable>
        ) : (
          <View style={[s.shotThumb, s.shotLoading]}>
            <ActivityIndicator size="small" color={colors.textMuted} />
          </View>
        )
      ) : null}

      {b64 ? (
        <Modal visible={zoom} transparent animationType="fade" onRequestClose={() => setZoom(false)}>
          <Pressable style={s.zoomBackdrop} onPress={() => setZoom(false)}>
            <Image source={{ uri: shotUri(b64) }} style={s.zoomImg} resizeMode="contain" />
            <View style={s.zoomClose}>
              <Ionicons name="close" size={26} color="#fff" />
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  section: { color: colors.textMuted, fontSize: 13, fontWeight: '800', textAlign: 'right', marginTop: 18, marginBottom: 8 },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 8 },
  vCard: { gap: 12, marginBottom: 10 },
  vHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  vTitle: { color: colors.text, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  vStatus: { fontSize: 13, fontWeight: '700', textAlign: 'right', marginTop: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  items: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10 },
  itemsCap: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  areaBlock: { gap: 6, marginTop: 4 },
  areaLabel: { color: colors.textSoft, fontSize: 12, fontWeight: '800', textAlign: 'right', opacity: 0.9 },
  itemWrap: { gap: 6 },
  itemRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  itemTxt: { flex: 1, color: colors.textSoft, fontSize: 14, textAlign: 'right', lineHeight: 20 },
  // Proof screenshot — full-width thumbnail tucked under the item text.
  shotThumbWrap: {
    marginRight: 24,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  shotThumb: { width: '100%', height: 150 },
  shotLoading: {
    marginRight: 24,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  shotZoomHint: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  shotZoomTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  // Full-screen zoom.
  zoomBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomImg: { width: '94%', height: '82%' },
  zoomClose: {
    position: 'absolute',
    top: 48,
    right: 20,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  badgeTxt: { fontSize: 12, fontWeight: '800' },
  pendNote: { color: colors.textMuted, fontSize: 13, textAlign: 'right', marginBottom: 2 },
});
