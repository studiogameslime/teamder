// GameFilterSheet — modal sheet for filtering the matches list.
//
// Filter dimensions (in display order):
//   • Format            — 5×5 / 6×6 / 7×7 (multi-select pills)
//   • Field type        — asphalt / synthetic / grass (multi-select)
//   • Visibility        — public / community-only (multi-select)
//   • Match rules       — hasReferee / hasPenalties / hasHalfTime
//   • Logistics         — bringBall / bringShirts / requiresApproval
//   • Availability      — only show games with open spots
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
import { FieldType, GameFormat } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const FORMATS: GameFormat[] = ['5v5', '6v6', '7v7'];
const FIELD_TYPES: FieldType[] = ['asphalt', 'synthetic', 'grass'];

export interface GameFilters {
  formats: GameFormat[];
  fieldTypes: FieldType[];
  /** true = "must be public", false = "must be community-only", null = any. */
  isPublic: boolean | null;
  hasReferee: boolean | null;
  hasPenalties: boolean | null;
  hasHalfTime: boolean | null;
  bringBall: boolean | null;
  bringShirts: boolean | null;
  requiresApproval: boolean | null;
  /** When true, hide games that are full (no spots in players + waitlist). */
  onlyAvailable: boolean;
}

export const EMPTY_GAME_FILTERS: GameFilters = {
  formats: [],
  fieldTypes: [],
  isPublic: null,
  hasReferee: null,
  hasPenalties: null,
  hasHalfTime: null,
  bringBall: null,
  bringShirts: null,
  requiresApproval: null,
  onlyAvailable: false,
};

export function isFiltersEmpty(f: GameFilters): boolean {
  return (
    f.formats.length === 0 &&
    f.fieldTypes.length === 0 &&
    f.isPublic === null &&
    f.hasReferee === null &&
    f.hasPenalties === null &&
    f.hasHalfTime === null &&
    f.bringBall === null &&
    f.bringShirts === null &&
    f.requiresApproval === null &&
    !f.onlyAvailable
  );
}

export function activeFiltersCount(f: GameFilters): number {
  let n = 0;
  if (f.formats.length) n += 1;
  if (f.fieldTypes.length) n += 1;
  if (f.isPublic !== null) n += 1;
  if (f.hasReferee !== null) n += 1;
  if (f.hasPenalties !== null) n += 1;
  if (f.hasHalfTime !== null) n += 1;
  if (f.bringBall !== null) n += 1;
  if (f.bringShirts !== null) n += 1;
  if (f.requiresApproval !== null) n += 1;
  if (f.onlyAvailable) n += 1;
  return n;
}

interface Props {
  visible: boolean;
  filters: GameFilters;
  onChange: (next: GameFilters) => void;
  onClose: () => void;
}

export function GameFilterSheet({ visible, filters, onChange, onClose }: Props) {
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
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
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

            {/* Visibility tri-state */}
            <Section title={he.gameFiltersVisibility}>
              <TriState
                value={filters.isPublic}
                onChange={(v) => onChange({ ...filters, isPublic: v })}
                yesLabel={he.wizardVisibilityPublic}
                noLabel={he.wizardVisibilityCommunity}
              />
            </Section>

            {/* Match rules */}
            <ToggleRow
              label={he.wizardHasReferee}
              value={filters.hasReferee}
              onChange={(v) => onChange({ ...filters, hasReferee: v })}
            />
            <ToggleRow
              label={he.wizardHasPenalties}
              value={filters.hasPenalties}
              onChange={(v) => onChange({ ...filters, hasPenalties: v })}
            />
            <ToggleRow
              label={he.wizardHasHalfTime}
              value={filters.hasHalfTime}
              onChange={(v) => onChange({ ...filters, hasHalfTime: v })}
            />

            {/* Logistics */}
            <ToggleRow
              label={he.createGameBringBall}
              value={filters.bringBall}
              onChange={(v) => onChange({ ...filters, bringBall: v })}
            />
            <ToggleRow
              label={he.createGameBringShirts}
              value={filters.bringShirts}
              onChange={(v) => onChange({ ...filters, bringShirts: v })}
            />
            <ToggleRow
              label={he.createGameRequiresApproval}
              value={filters.requiresApproval}
              onChange={(v) => onChange({ ...filters, requiresApproval: v })}
            />

            {/* Availability boolean */}
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{he.gameFiltersOnlyAvailable}</Text>
              <Switch
                value={filters.onlyAvailable}
                onValueChange={(v) =>
                  onChange({ ...filters, onlyAvailable: v })
                }
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
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
                title={he.gameFiltersApply}
                variant="primary"
                size="lg"
                fullWidth
                onPress={onClose}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
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
 * visibility filter (ציבורי / קהילה).
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

export function applyGameFilters<T extends {
  format?: GameFormat;
  fieldType?: FieldType;
  isPublic?: boolean;
  hasReferee?: boolean;
  hasPenalties?: boolean;
  hasHalfTime?: boolean;
  bringBall?: boolean;
  bringShirts?: boolean;
  requiresApproval?: boolean;
  maxPlayers: number;
  players: string[];
}>(games: T[], f: GameFilters): T[] {
  return games.filter((g) => {
    if (f.formats.length > 0 && (!g.format || !f.formats.includes(g.format))) {
      return false;
    }
    if (
      f.fieldTypes.length > 0 &&
      (!g.fieldType || !f.fieldTypes.includes(g.fieldType))
    ) {
      return false;
    }
    if (f.isPublic !== null && !!g.isPublic !== f.isPublic) return false;
    if (f.hasReferee !== null && !!g.hasReferee !== f.hasReferee) return false;
    if (f.hasPenalties !== null && !!g.hasPenalties !== f.hasPenalties) {
      return false;
    }
    if (f.hasHalfTime !== null && !!g.hasHalfTime !== f.hasHalfTime) {
      return false;
    }
    if (f.bringBall !== null && !!g.bringBall !== f.bringBall) return false;
    if (f.bringShirts !== null && !!g.bringShirts !== f.bringShirts) {
      return false;
    }
    if (
      f.requiresApproval !== null &&
      !!g.requiresApproval !== f.requiresApproval
    ) {
      return false;
    }
    if (f.onlyAvailable && g.players.length >= g.maxPlayers) return false;
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
    // Fixed height (not maxHeight) — without an explicit height the
    // body's ScrollView `flex:1` collapses to 0 because there's no
    // defined parent height for it to share.
    height: '85%',
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
