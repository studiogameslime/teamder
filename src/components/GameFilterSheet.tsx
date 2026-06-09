// GameFilterSheet — modal sheet for filtering the matches list.
//
// Filter dimensions (in display order):
//   • When              — any / today / thisWeek / weekend
//   • Format            — 5×5 / 6×6 / 7×7 (multi-select pills)
//   • Field type        — asphalt / synthetic / grass (multi-select)
//   • Cost              — any / free / paid
//   • Visibility        — public / community-only (tri-state)
//   • Approval          — requiresApproval tri-state
//   • Availability      — only show games with open spots
//
// Removed dimensions (product decision — filters that no longer match
// what the wizard sets):
//   • hasReferee/hasPenalties/hasHalfTime — superseded by free-text
//     `ruleTags` chips at the game level; legacy fields kept on Game
//     for backward-compat with old documents but never set by the
//     wizard, so filtering by them was always empty in practice.
//   • bringBall/bringShirts — removed from the wizard per product
//     decision (community-level setting, surfaced inline on match
//     details rather than per game). Defaults to true on every game
//     so a yes/no filter has nothing to do.
//
// A null value on any tri-state means "don't filter on this dimension".
// The list screen owns the GameFilters state; this component is purely
// presentational and reports changes via `onChange`.

import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { RadiusSelector } from './RadiusSelector';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { FieldType, GameFormat } from '@/types';
import { haversineKm } from '@/utils/geo';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const FORMATS: GameFormat[] = ['5v5', '6v6', '7v7'];
const FIELD_TYPES: FieldType[] = ['asphalt', 'synthetic', 'grass'];

/** Date window — leads the filter sheet because "מתי" is the question
 *  most users have first. */
export type GameTimeWindow = 'any' | 'today' | 'thisWeek' | 'weekend';
/** Cost slice — surfaced near the top so a paid game never surprises. */
export type GameCostFilter = 'any' | 'free' | 'paid';

export interface GameFilters {
  /** Time window — primary question, surfaces at the top of the sheet. */
  when: GameTimeWindow;
  formats: GameFormat[];
  fieldTypes: FieldType[];
  /** "public" = must be open to the whole app, "community" = members-only,
   *  null = any. */
  visibility: 'public' | 'community' | null;
  /** Cost slice — most local games are free; this is rare to set but
   *  worth surfacing. */
  cost: GameCostFilter;
  requiresApproval: boolean | null;
  /** When true, hide games that are full (no spots in players + waitlist). */
  onlyAvailable: boolean;
  /** Match games within `nearbyRadiusKm` of the viewer's location. The
   *  list screen resolves the viewer's coords and passes them to
   *  `applyGameFilters` via ctx. */
  nearby: boolean;
  /** Radius in km — only consulted when `nearby` is true. */
  nearbyRadiusKm: number;
}

/** Default "near me" radius — a metro-area cluster. */
export const DEFAULT_GAME_NEARBY_RADIUS_KM = 25;

export const EMPTY_GAME_FILTERS: GameFilters = {
  when: 'any',
  formats: [],
  fieldTypes: [],
  visibility: null,
  cost: 'any',
  requiresApproval: null,
  onlyAvailable: false,
  nearby: false,
  nearbyRadiusKm: DEFAULT_GAME_NEARBY_RADIUS_KM,
};

export function isFiltersEmpty(f: GameFilters): boolean {
  return (
    f.when === 'any' &&
    f.formats.length === 0 &&
    f.fieldTypes.length === 0 &&
    f.visibility === null &&
    f.cost === 'any' &&
    f.requiresApproval === null &&
    !f.onlyAvailable &&
    !f.nearby
  );
}

export function activeFiltersCount(f: GameFilters): number {
  let n = 0;
  if (f.when !== 'any') n += 1;
  if (f.formats.length) n += 1;
  if (f.fieldTypes.length) n += 1;
  if (f.visibility !== null) n += 1;
  if (f.cost !== 'any') n += 1;
  if (f.requiresApproval !== null) n += 1;
  if (f.onlyAvailable) n += 1;
  if (f.nearby) n += 1;
  return n;
}

/** Apply the time window to a startsAt timestamp. */
export function gameMatchesWhen(
  startsAt: number,
  when: GameTimeWindow,
  now = Date.now(),
): boolean {
  if (when === 'any') return true;
  if (startsAt < now) return false;
  const d = new Date(now);
  const todayEnd = new Date(d);
  todayEnd.setHours(23, 59, 59, 999);
  if (when === 'today') return startsAt <= todayEnd.getTime();
  if (when === 'thisWeek') {
    // ISO week, Sun → Sat in Israel
    const day = d.getDay();
    const daysUntilSat = (6 - day + 7) % 7;
    const weekEnd = new Date(d);
    weekEnd.setDate(d.getDate() + daysUntilSat);
    weekEnd.setHours(23, 59, 59, 999);
    return startsAt <= weekEnd.getTime();
  }
  if (when === 'weekend') {
    // "סופ״ש" in Israel = Fri + Sat
    const day = d.getDay();
    const daysUntilFri = (5 - day + 7) % 7;
    const friStart = new Date(d);
    friStart.setDate(d.getDate() + daysUntilFri);
    friStart.setHours(0, 0, 0, 0);
    const satEnd = new Date(friStart);
    satEnd.setDate(friStart.getDate() + 1);
    satEnd.setHours(23, 59, 59, 999);
    return startsAt >= friStart.getTime() && startsAt <= satEnd.getTime();
  }
  return true;
}

interface Props {
  visible: boolean;
  filters: GameFilters;
  onChange: (next: GameFilters) => void;
  onClose: () => void;
  /**
   * Live count of games that match the *current* filter draft. When
   * provided, the Apply button shows "החל (N)" so the user can see
   * the effect of each toggle without closing the sheet.
   */
  matchCount?: number;
  /** Optional caption under the "near me" toggle (e.g. resolved city). */
  nearbyCaption?: string;
}

export function GameFilterSheet({
  visible,
  filters,
  onChange,
  onClose,
  matchCount,
  nearbyCaption,
}: Props) {
  const toggleFormat = (f: GameFormat) =>
    onChange({
      ...filters,
      formats: filters.formats.includes(f)
        ? filters.formats.filter((x) => x !== f)
        : [...filters.formats, f],
    });
  const toggleFieldType = (f: FieldType) =>
    onChange({
      ...filters,
      fieldTypes: filters.fieldTypes.includes(f)
        ? filters.fieldTypes.filter((x) => x !== f)
        : [...filters.fieldTypes, f],
    });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <SpringSheet visible={visible} onBackdropPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{he.gameFiltersTitle}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* When — primary filter, surfaces first. */}
            <Section title={he.gameFiltersWhen}>
              <PillRow>
                {(['any', 'today', 'thisWeek', 'weekend'] as const).map((w) => (
                  <Pill
                    key={w}
                    active={filters.when === w}
                    label={
                      w === 'any'
                        ? he.gameFiltersWhenAny
                        : w === 'today'
                          ? he.gameFiltersWhenToday
                          : w === 'thisWeek'
                            ? he.gameFiltersWhenThisWeek
                            : he.gameFiltersWhenWeekend
                    }
                    onPress={() => onChange({ ...filters, when: w })}
                  />
                ))}
              </PillRow>
            </Section>

            {/* Near me — discovery by distance. Toggling reveals the
                radius pills. The list screen resolves the viewer's GPS. */}
            <Pressable
              onPress={() => onChange({ ...filters, nearby: !filters.nearby })}
              style={styles.switchRow}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>{he.filterNearby}</Text>
                {nearbyCaption ? (
                  <Text style={styles.switchCaption}>{nearbyCaption}</Text>
                ) : null}
              </View>
              <Switch
                value={filters.nearby}
                onValueChange={(v) => onChange({ ...filters, nearby: v })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </Pressable>
            {filters.nearby ? (
              <RadiusSelector
                value={filters.nearbyRadiusKm}
                onChange={(km) => onChange({ ...filters, nearbyRadiusKm: km })}
              />
            ) : null}

            {/* Format multi-select */}
            <Section title={he.createGameFormat}>
              <PillRow>
                {FORMATS.map((f) => (
                  <Pill
                    key={f}
                    active={filters.formats.includes(f)}
                    label={formatLabel(f)}
                    onPress={() => toggleFormat(f)}
                  />
                ))}
              </PillRow>
            </Section>

            {/* Field type multi-select */}
            <Section title={he.createGameFieldType}>
              <PillRow>
                {FIELD_TYPES.map((f) => (
                  <Pill
                    key={f}
                    active={filters.fieldTypes.includes(f)}
                    label={fieldTypeLabel(f)}
                    onPress={() => toggleFieldType(f)}
                  />
                ))}
              </PillRow>
            </Section>

            {/* Cost slice */}
            <Section title={he.gameFiltersCost}>
              <PillRow>
                {(['any', 'free', 'paid'] as const).map((c) => (
                  <Pill
                    key={c}
                    active={filters.cost === c}
                    label={
                      c === 'any'
                        ? he.gameFiltersWhenAny
                        : c === 'free'
                          ? he.gameFiltersCostFree
                          : he.gameFiltersCostPaid
                    }
                    onPress={() => onChange({ ...filters, cost: c })}
                  />
                ))}
              </PillRow>
            </Section>

            {/* Visibility tri-state — adapter maps the new
                'public'|'community'|null filter to the boolean
                tri-state component without redesigning it. */}
            <Section title={he.gameFiltersVisibility}>
              <TriState
                value={
                  filters.visibility === 'public'
                    ? true
                    : filters.visibility === 'community'
                      ? false
                      : null
                }
                onChange={(v) =>
                  onChange({
                    ...filters,
                    visibility:
                      v === true ? 'public' : v === false ? 'community' : null,
                  })
                }
                yesLabel={he.wizardVisibilityPublic}
                noLabel={he.wizardVisibilityCommunity}
              />
            </Section>

            {/* Approval requirement — the only logistics dimension that
                remains gated by the wizard. (bringBall/bringShirts and
                hasReferee/hasPenalties/hasHalfTime were removed; see
                top-of-file note.) */}
            <ToggleRow
              label={he.createGameRequiresApproval}
              value={filters.requiresApproval}
              onChange={(v) => onChange({ ...filters, requiresApproval: v })}
            />

            {/* Availability boolean — wrapped in Pressable so the
                label is also tappable, matching the rest of the
                toggle rows in the app. */}
            <Pressable
              onPress={() =>
                onChange({
                  ...filters,
                  onlyAvailable: !filters.onlyAvailable,
                })
              }
              style={styles.switchRow}
            >
              <Text style={styles.switchLabel}>{he.gameFiltersOnlyAvailable}</Text>
              <Switch
                value={filters.onlyAvailable}
                onValueChange={(v) =>
                  onChange({ ...filters, onlyAvailable: v })
                }
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </Pressable>
          </ScrollView>

          <View style={styles.footer}>
            <Button
              title={he.gameFiltersReset}
              variant="outline"
              size="lg"
              onPress={() => onChange(EMPTY_GAME_FILTERS)}
            />
            <View style={{ flex: 1 }}>
              <Button
                title={
                  typeof matchCount === 'number'
                    ? `${he.gameFiltersApply} (${matchCount})`
                    : he.gameFiltersApply
                }
                variant="primary"
                size="lg"
                fullWidth
                onPress={onClose}
              />
            </View>
          </View>
        </Pressable>
      </SpringSheet>
    </Modal>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function PillRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.pillRow}>{children}</View>;
}

function Pill({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        active && styles.pillActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{label}</Text>
      <TriState value={value} onChange={onChange} />
    </View>
  );
}

/**
 * Tri-state pill row: any / yes / no. `null` = any (no filter).
 * Default labels are "כן" / "לא" but callers can override e.g. for the
 * visibility filter (ציבורי / מועדון).
 */
function TriState({
  value,
  onChange,
  yesLabel,
  noLabel,
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  yesLabel?: string;
  noLabel?: string;
}) {
  const opts: Array<{ v: boolean | null; label: string }> = [
    { v: null, label: he.gameFiltersAny },
    { v: true, label: yesLabel ?? he.yes },
    { v: false, label: noLabel ?? he.no },
  ];
  return (
    <View style={styles.pillRow}>
      {opts.map((o) => (
        <Pill
          key={String(o.v)}
          active={value === o.v}
          label={o.label}
          onPress={() => onChange(o.v)}
        />
      ))}
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatLabel(f: GameFormat): string {
  if (f === '5v5') return he.gameFormat5;
  if (f === '6v6') return he.gameFormat6;
  return he.gameFormat7;
}
function fieldTypeLabel(f: FieldType): string {
  if (f === 'asphalt') return he.fieldTypeAsphalt;
  if (f === 'synthetic') return he.fieldTypeSynthetic;
  return he.fieldTypeGrass;
}

// ─── Filter application — pure function consumed by the list screen ────

/** Context for the "near me" filter — the list screen resolves the
 *  viewer's coords (and an optional city fallback for legacy games that
 *  predate field-coords) and passes them here. */
export interface GameApplyContext {
  nearbyLatLng?: { lat: number; lng: number };
  nearbyCityFallback?: string;
}

export function applyGameFilters<T extends {
  startsAt: number;
  format?: GameFormat;
  fieldType?: FieldType;
  visibility?: 'public' | 'community';
  costPerGame?: number;
  requiresApproval?: boolean;
  maxPlayers: number;
  players: string[];
  fieldLat?: number;
  fieldLng?: number;
  city?: string;
}>(games: T[], f: GameFilters, ctx: GameApplyContext = {}): T[] {
  return games.filter((g) => {
    if (!gameMatchesWhen(g.startsAt, f.when)) return false;
    if (f.formats.length > 0 && (!g.format || !f.formats.includes(g.format))) {
      return false;
    }
    if (
      f.fieldTypes.length > 0 &&
      (!g.fieldType || !f.fieldTypes.includes(g.fieldType))
    ) {
      return false;
    }
    if (f.visibility !== null && (g.visibility ?? 'community') !== f.visibility) {
      return false;
    }
    if (f.cost !== 'any') {
      const isFree = !g.costPerGame || g.costPerGame === 0;
      if (f.cost === 'free' && !isFree) return false;
      if (f.cost === 'paid' && isFree) return false;
    }
    if (
      f.requiresApproval !== null &&
      !!g.requiresApproval !== f.requiresApproval
    ) {
      return false;
    }
    if (f.onlyAvailable && g.players.length >= g.maxPlayers) return false;
    if (f.nearby) {
      // Preferred: radius via GPS against the game's field coords.
      if (
        ctx.nearbyLatLng &&
        typeof g.fieldLat === 'number' &&
        typeof g.fieldLng === 'number'
      ) {
        const km = haversineKm(ctx.nearbyLatLng, {
          lat: g.fieldLat,
          lng: g.fieldLng,
        });
        if (km > f.nearbyRadiusKm) return false;
        return true;
      }
      // Fallback for legacy games without field coords — exact city match.
      if (ctx.nearbyCityFallback && g.city) {
        return (
          g.city.trim().toLowerCase() ===
          ctx.nearbyCityFallback.trim().toLowerCase()
        );
      }
      // Can't verify distance — exclude from a "near me" result.
      return false;
    }
    return true;
  });
}

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    // Take the full height the SpringSheet wrapper allows (it clamps
    // to 90% of screen with maxHeight). The body ScrollView below
    // uses `flex:1` to absorb any leftover space — without an
    // explicit minHeight the sheet would shrink to its content,
    // leaving the action footer floating mid-screen instead of
    // pinned to the bottom.
    minHeight: '70%',
    maxHeight: '100%',
    paddingBottom: spacing.xl,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
  },
  body: { flex: 1 },
  bodyContent: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  section: { gap: spacing.xs },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    width: '100%',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  pillText: { ...typography.body, color: colors.textMuted },
  pillTextActive: { color: colors.primary, fontWeight: '700' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  switchLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  switchCaption: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
    width: '100%',
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    alignItems: 'center',
  },
});
