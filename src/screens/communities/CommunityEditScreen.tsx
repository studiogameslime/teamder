// CommunityEditScreen — coaches edit team metadata.
//
// Permissions: any coach (member of `adminIds`) can save. Coach
// promotion / demotion lives on CommunityDetailsScreen and stays
// creator-only.
//
// Layout: four explicit sections with bold right-aligned titles,
// mirroring the rhythm of MatchDetails / CommunityDetails so the three
// "edit / view a thing" surfaces all read with one hierarchy.
//
//   A. פרטים בסיסיים   — name, city, field
//   B. מתי משחקים      — preferred days, preferred hour, schedule preview
//   C. הגדרות קבוצה    — max members, isOpen, recurring toggle
//   D. פרטים נוספים    — phone, description, rules
//
// All Hebrew copy is right-aligned. Pills, inputs, switches and the
// schedule-preview line use textAlign:'right' + writingDirection:'rtl'.
// The save button sits in a sticky footer above the safe-area bottom
// inset (so it always clears the AdMob banner).

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { InputField } from '@/components/InputField';
import { AppTimeField } from '@/components/DateTimeFields';
import { groupService } from '@/services';
import { isValidIsraeliPhone } from '@/services/whatsappService';
import { WeekdayIndex } from '@/types';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';

type RouteParams = { CommunityEdit: { groupId: string } };

const ALL_DAYS: WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];

export function CommunityEditScreen() {
  const route = useRoute<RouteProp<RouteParams, 'CommunityEdit'>>();
  const nav = useNavigation();
  const { groupId } = route.params;
  const me = useUserStore((s) => s.currentUser);
  const groups = useGroupStore((s) => s.groups);
  const reloadGroups = useGroupStore((s) => s.hydrate);
  const original = groups.find((g) => g.id === groupId);

  // Field state — seeded from the in-store group. Last-write-wins if
  // another coach is editing simultaneously (acceptable for v1).
  const [name, setName] = useState(original?.name ?? '');
  const [city, setCity] = useState(original?.city ?? '');
  const [fieldName, setFieldName] = useState(original?.fieldName ?? '');
  const [contactPhone, setContactPhone] = useState(
    original?.contactPhone ?? '',
  );
  const [description, setDescription] = useState(original?.description ?? '');
  const [rules, setRules] = useState(original?.rules ?? '');
  const [preferredDays, setPreferredDays] = useState<WeekdayIndex[]>(
    original?.preferredDays ?? [],
  );
  const [preferredHour, setPreferredHour] = useState(
    original?.preferredHour ?? '',
  );
  const [maxMembers, setMaxMembers] = useState(
    original?.maxMembers ? String(original.maxMembers) : '',
  );
  const [isOpen, setIsOpen] = useState(original?.isOpen ?? false);
  const [recurringGameEnabled, setRecurringGameEnabled] = useState(
    original?.recurringGameEnabled ?? false,
  );
  const [busy, setBusy] = useState(false);

  if (!me || !original) return null;

  const canEdit = original.adminIds.includes(me.id);
  if (!canEdit) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.communityEditTitle} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{he.communityEditNoPermission}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const phoneOk = !contactPhone || isValidIsraeliPhone(contactPhone);

  // Compare current state to the original group so the save button
  // can disable itself when nothing is dirty. We compare on the
  // string / boolean / array shape that maps onto Firestore fields,
  // not on the in-state references.
  const hasChanges = useMemo(() => {
    const cap = parseInt(maxMembers, 10);
    const capParsed = Number.isFinite(cap) && cap > 0 ? cap : undefined;
    const sortedDaysA = [...preferredDays].sort().join(',');
    const sortedDaysB = [...(original.preferredDays ?? [])].sort().join(',');
    return (
      name.trim() !== (original.name ?? '') ||
      (city.trim() || undefined) !== (original.city ?? undefined) ||
      fieldName.trim() !== (original.fieldName ?? '') ||
      (contactPhone.trim() || undefined) !==
        (original.contactPhone ?? undefined) ||
      (description.trim() || undefined) !==
        (original.description ?? undefined) ||
      (rules.trim() || undefined) !== (original.rules ?? undefined) ||
      sortedDaysA !== sortedDaysB ||
      (preferredHour || undefined) !== (original.preferredHour ?? undefined) ||
      capParsed !== (original.maxMembers ?? undefined) ||
      isOpen !== (original.isOpen ?? false) ||
      recurringGameEnabled !== (original.recurringGameEnabled ?? false)
    );
  }, [
    name,
    city,
    fieldName,
    contactPhone,
    description,
    rules,
    preferredDays,
    preferredHour,
    maxMembers,
    isOpen,
    recurringGameEnabled,
    original,
  ]);

  const canSave = !busy && name.trim().length > 0 && phoneOk && hasChanges;

  const toggleDay = (d: WeekdayIndex) => {
    setPreferredDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const cap = parseInt(maxMembers, 10);
      await groupService.updateGroupMetadata(original.id, me.id, {
        name: name.trim(),
        city: city.trim() || undefined,
        fieldName: fieldName.trim(),
        contactPhone: contactPhone.trim() || undefined,
        description: description.trim() || undefined,
        rules: rules.trim() || undefined,
        preferredDays,
        preferredHour: preferredHour || undefined,
        maxMembers: Number.isFinite(cap) && cap > 0 ? cap : undefined,
        isOpen,
        recurringGameEnabled,
      });
      await reloadGroups(me.id);
      nav.goBack();
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  // Schedule preview — only shown when we have enough to render a
  // useful sentence. Uses the FIRST preferred day so the line stays
  // readable even when the team plays multiple days a week. Returns
  // null on missing data so the caller can suppress the row entirely.
  const schedulePreview = useMemo(() => {
    if (
      preferredDays.length === 0 ||
      !preferredHour ||
      !fieldName.trim()
    ) {
      return null;
    }
    const day = he.weekdayLong[preferredDays[0]];
    const text = he.communityEditSchedulePreview(
      day,
      preferredHour,
      fieldName.trim(),
    );
    return text || null;
  }, [preferredDays, preferredHour, fieldName]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.communityEditTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* ─── A. פרטים בסיסיים ─────────────────────────── */}
        <SectionTitle title={he.communityEditSectionBasics} />
        <View style={styles.fieldStack}>
          <InputField
            label={he.groupCreateName}
            value={name}
            onChangeText={setName}
          />
          <InputField
            label={he.createGroupCity}
            value={city}
            onChangeText={setCity}
          />
          <InputField
            label={he.groupCreateField}
            value={fieldName}
            onChangeText={setFieldName}
          />
        </View>

        {/* ─── B. מתי משחקים ────────────────────────────── */}
        <SectionTitle title={he.communityEditSectionSchedule} />
        <View>
          <Text style={styles.fieldLabel}>
            {he.communityEditPreferredDaysLabel}
          </Text>
          <View style={styles.pillRow}>
            {ALL_DAYS.map((d) => (
              <DayChip
                key={d}
                label={he.availabilityDayShort[d]}
                active={preferredDays.includes(d)}
                onPress={() => toggleDay(d)}
              />
            ))}
          </View>
        </View>
        <AppTimeField
          label={`${he.communityEditPreferredHourLabel}  (${he.communityEditOptional})`}
          value={preferredHour}
          onChange={setPreferredHour}
          placeholder={preferredHour ? '' : he.communityEditTimeUnset}
        />
        {schedulePreview ? (
          <View style={styles.previewCard}>
            <Ionicons
              name="sparkles-outline"
              size={16}
              color={colors.primary}
              style={styles.previewIcon}
            />
            <Text style={styles.previewText} numberOfLines={2}>
              {schedulePreview}
            </Text>
          </View>
        ) : null}

        {/* ─── C. הגדרות קבוצה ──────────────────────────── */}
        <SectionTitle title={he.communityEditSectionSettings} />
        <View style={styles.fieldStack}>
          <InputField
            label={he.createGroupMaxMembers}
            value={maxMembers}
            onChangeText={setMaxMembers}
            keyboardType="number-pad"
          />
          <ToggleCard
            label={he.createGroupIsOpen}
            hint={he.communityEditIsOpenHint}
            value={isOpen}
            onValueChange={setIsOpen}
          />
          <ToggleCard
            label={he.communityEditRecurringEnabled}
            hint={he.communityEditRecurringHint}
            value={recurringGameEnabled}
            onValueChange={setRecurringGameEnabled}
          />
        </View>

        {/* ─── D. פרטים נוספים ──────────────────────────── */}
        <SectionTitle title={he.communityEditSectionExtra} />
        <View style={styles.fieldStack}>
          <View>
            <InputField
              label={he.createGroupContactPhone}
              value={contactPhone}
              onChangeText={setContactPhone}
              keyboardType="phone-pad"
              placeholder={he.createGroupContactPhonePlaceholder}
            />
            {!phoneOk ? (
              <Text style={styles.errorHint}>
                {he.createGroupContactPhoneInvalid}
              </Text>
            ) : null}
          </View>
          <InputField
            label={he.createGroupDescription}
            value={description}
            onChangeText={setDescription}
            multiline
          />
          <InputField
            label={he.communityDetailsRules}
            value={rules}
            onChangeText={setRules}
            multiline
          />
        </View>
      </ScrollView>

      {/* Sticky save bar — top hairline anchors it; keeps the user's
          most important action in reach. SafeArea bottom inset is
          honoured by the wrapping View so the AdMob banner doesn't
          eat the button on small phones. */}
      <SafeAreaView edges={['bottom']} style={styles.saveBarSafe}>
        <View style={styles.saveBar}>
          <Button
            title={he.save}
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={!canSave}
            onPress={save}
          />
        </View>
      </SafeAreaView>
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

/**
 * Day-letter chip. Square (44×44 circle so all 7 letters line up
 * regardless of width) with a green primary highlight when selected
 * and a light outline when not.
 */
function DayChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dayPill,
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

/**
 * Switch row inside a surface card. Used for boolean settings so the
 * row reads as a tappable affordance and not a stray inline control
 * floating in the form. Layout (RTL): label/hint on the right, switch
 * on the left.
 */
function ToggleCard({
  label,
  hint,
  value,
  onValueChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleCard}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel} numberOfLines={2}>
          {label}
        </Text>
        {hint ? (
          <Text style={styles.toggleHint} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

/**
 * Spread on every Text style in this screen. App.tsx sets a Text-level
 * defaultProps with the same pair, but RN replaces (does NOT merge) the
 * `style` prop when a child passes its own — so the cascade only kicks
 * in for Text components without any explicit style. Including the
 * pair locally guarantees right alignment regardless.
 *
 * Use `RTL_TEXT_BLOCK` (with stretch + 100% width) on standalone
 * labels that sit on their own row; use the bare `RTL_TEXT` on Text
 * that lives inside a flex row where the parent controls width.
 */
const RTL_TEXT = {
  textAlign: 'right' as const,
  writingDirection: 'rtl' as const,
};
const RTL_TEXT_BLOCK = {
  ...RTL_TEXT,
  alignSelf: 'stretch' as const,
  width: '100%' as const,
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },

  // Section title — same shape as MatchDetails / CommunityDetails so the
  // edit / view "the thing" surfaces all read with one rhythm.
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginTop: spacing.sm,
    ...RTL_TEXT_BLOCK,
  },

  /** Label that sits above a non-InputField control (pill row, time
   *  picker). Same colour/weight as the InputField's internal label. */
  fieldLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    ...RTL_TEXT_BLOCK,
  },
  /** Inline "(לא חובה)" hint baked into a label. */
  fieldOptional: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '400',
  },

  /** Stack of fields inside a section. */
  fieldStack: {
    gap: spacing.sm,
  },

  errorHint: {
    ...typography.caption,
    color: colors.danger,
    marginTop: 4,
    ...RTL_TEXT_BLOCK,
  },

  // Pill row (days). Wrapped so 7 chips collapse to two rows on tight
  // widths instead of horizontally scrolling.
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  /** Day-letter pill — fixed square so all 7 letters line up evenly. */
  dayPill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  pillText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
  },
  pillTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },

  // Schedule preview card — light-green pill that reassures the user
  // their config will produce a sensible auto-game.
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  previewIcon: {
    // marginEnd is RTL-aware: under forceRTL it resolves to the icon's
    // physical LEFT — exactly where we want the gap to the text.
    marginEnd: 4,
  },
  previewText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    flexShrink: 1,
    ...RTL_TEXT,
  },

  // Switch row card.
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  toggleText: {
    flexShrink: 1,
    alignItems: 'flex-start',
  },
  toggleLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    ...RTL_TEXT,
  },
  toggleHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    ...RTL_TEXT,
  },

  // Sticky save bar
  saveBarSafe: {
    backgroundColor: colors.surface,
  },
  saveBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    ...RTL_TEXT,
  },
});
