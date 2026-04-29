// CommunityEditScreen — coaches edit team metadata.
//
// Permissions: any coach (member of `adminIds`) can save. Coach
// promotion / demotion lives on CommunityDetailsScreen and stays
// creator-only. This screen never touches `adminIds` or `creatorId`.

import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { InputField } from '@/components/InputField';
import { AppTimeField } from '@/components/DateTimeFields';
import { groupService } from '@/services';
import { isValidIsraeliPhone } from '@/services/whatsappService';
import {
  GameFormat,
  Group,
  SkillLevel,
  WeekdayIndex,
} from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';

type RouteParams = { CommunityEdit: { groupId: string } };

const ALL_DAYS: WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];
const SKILL_LEVELS: SkillLevel[] = [
  'beginner',
  'intermediate',
  'advanced',
  'mixed',
];
const SKILL_LABELS: Record<SkillLevel, string> = {
  beginner: he.skillBeginner,
  intermediate: he.skillIntermediate,
  advanced: he.skillAdvanced,
  mixed: he.skillMixed,
};
const FORMATS: GameFormat[] = ['5v5', '6v6', '7v7'];

export function CommunityEditScreen() {
  const route = useRoute<RouteProp<RouteParams, 'CommunityEdit'>>();
  const nav = useNavigation();
  const { groupId } = route.params;
  const me = useUserStore((s) => s.currentUser);
  const groups = useGroupStore((s) => s.groups);
  const reloadGroups = useGroupStore((s) => s.hydrate);
  const original = groups.find((g) => g.id === groupId);

  // Field state — seeded from the in-store group. We don't try to
  // re-fetch from Firestore here; if the user edits while another
  // coach is also editing, the last write wins (acceptable for v1).
  const [name, setName] = useState(original?.name ?? '');
  const [city, setCity] = useState(original?.city ?? '');
  const [fieldName, setFieldName] = useState(original?.fieldName ?? '');
  const [contactPhone, setContactPhone] = useState(
    original?.contactPhone ?? '',
  );
  const [description, setDescription] = useState(original?.description ?? '');
  const [rules, setRules] = useState(original?.rules ?? '');
  const [skillLevel, setSkillLevel] = useState<SkillLevel>(
    original?.skillLevel ?? 'mixed',
  );
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
  const [recurringDayOfWeek, setRecurringDayOfWeek] = useState<
    WeekdayIndex | undefined
  >(original?.recurringDayOfWeek);
  const [recurringTime, setRecurringTime] = useState(
    original?.recurringTime ?? '',
  );
  const [recurringDefaultFormat, setRecurringDefaultFormat] = useState<
    GameFormat | undefined
  >(original?.recurringDefaultFormat);
  const [recurringNumberOfTeams, setRecurringNumberOfTeams] = useState(
    original?.recurringNumberOfTeams
      ? String(original.recurringNumberOfTeams)
      : '',
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

  const phoneOk =
    !contactPhone || isValidIsraeliPhone(contactPhone);
  const canSave = !busy && name.trim().length > 0 && phoneOk;

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
      const teams = parseInt(recurringNumberOfTeams, 10);
      await groupService.updateGroupMetadata(original.id, me.id, {
        name: name.trim(),
        city: city.trim() || undefined,
        fieldName: fieldName.trim(),
        contactPhone: contactPhone.trim() || undefined,
        description: description.trim() || undefined,
        rules: rules.trim() || undefined,
        skillLevel,
        preferredDays,
        preferredHour: preferredHour || undefined,
        maxMembers: Number.isFinite(cap) && cap > 0 ? cap : undefined,
        isOpen,
        recurringGameEnabled,
        recurringDayOfWeek,
        recurringTime: recurringTime || undefined,
        recurringDefaultFormat,
        recurringNumberOfTeams:
          Number.isFinite(teams) && teams >= 2 ? teams : undefined,
      });
      // Re-hydrate the store so the details screen + feed pick up the
      // new copy without a manual refresh.
      await reloadGroups(me.id);
      nav.goBack();
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.communityEditTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        <Field label={he.groupCreateName} value={name} onChange={setName} />
        <Field label={he.createGroupCity} value={city} onChange={setCity} />
        <Field
          label={he.groupCreateField}
          value={fieldName}
          onChange={setFieldName}
        />
        <View>
          <Field
            label={he.createGroupContactPhone}
            value={contactPhone}
            onChange={setContactPhone}
            keyboardType="phone-pad"
            placeholder={he.createGroupContactPhonePlaceholder}
          />
          {!phoneOk ? (
            <Text style={styles.errorHint}>
              {he.createGroupContactPhoneInvalid}
            </Text>
          ) : null}
        </View>
        <Field
          label={he.createGroupDescription}
          value={description}
          onChange={setDescription}
          multiline
        />
        <Field
          label={he.communityDetailsRules}
          value={rules}
          onChange={setRules}
          multiline
        />

        <View style={styles.field}>
          <Text style={styles.label}>{he.createGroupSkillLevel}</Text>
          <View style={styles.pillRow}>
            {SKILL_LEVELS.map((s) => (
              <Pressable
                key={s}
                onPress={() => setSkillLevel(s)}
                style={({ pressed }) => [
                  styles.pill,
                  skillLevel === s && styles.pillActive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    skillLevel === s && styles.pillTextActive,
                  ]}
                >
                  {SKILL_LABELS[s]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{he.createGroupPreferredDays}</Text>
          <View style={styles.pillRow}>
            {ALL_DAYS.map((d) => {
              const active = preferredDays.includes(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => toggleDay(d)}
                  style={({ pressed }) => [
                    styles.dayPill,
                    active && styles.pillActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      active && styles.pillTextActive,
                    ]}
                  >
                    {he.availabilityDayShort[d]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <AppTimeField
          label={he.createGroupPreferredHour}
          value={preferredHour}
          onChange={setPreferredHour}
        />

        <Field
          label={he.createGroupMaxMembers}
          value={maxMembers}
          onChange={setMaxMembers}
          keyboardType="number-pad"
        />

        <View style={styles.toggleRow}>
          <Text style={styles.label}>{he.createGroupIsOpen}</Text>
          <Switch
            value={isOpen}
            onValueChange={setIsOpen}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <Text style={styles.label}>
              {he.communityEditRecurringEnabled}
            </Text>
            <Switch
              value={recurringGameEnabled}
              onValueChange={setRecurringGameEnabled}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
          {recurringGameEnabled ? (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>{he.createGroupPreferredDays}</Text>
                <View style={styles.pillRow}>
                  {ALL_DAYS.map((d) => {
                    const active = recurringDayOfWeek === d;
                    return (
                      <Pressable
                        key={d}
                        onPress={() =>
                          setRecurringDayOfWeek(active ? undefined : d)
                        }
                        style={({ pressed }) => [
                          styles.dayPill,
                          active && styles.pillActive,
                          pressed && { opacity: 0.85 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.pillText,
                            active && styles.pillTextActive,
                          ]}
                        >
                          {he.availabilityDayShort[d]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <AppTimeField
                label={he.createGroupPreferredHour}
                value={recurringTime}
                onChange={setRecurringTime}
              />
              <View style={styles.field}>
                <Text style={styles.label}>{he.createGameFormat}</Text>
                <View style={styles.pillRow}>
                  {FORMATS.map((f) => {
                    const active = recurringDefaultFormat === f;
                    return (
                      <Pressable
                        key={f}
                        onPress={() =>
                          setRecurringDefaultFormat(active ? undefined : f)
                        }
                        style={({ pressed }) => [
                          styles.pill,
                          active && styles.pillActive,
                          pressed && { opacity: 0.85 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.pillText,
                            active && styles.pillTextActive,
                          ]}
                        >
                          {f}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Field
                label={he.createGameNumberOfTeams}
                value={recurringNumberOfTeams}
                onChange={setRecurringNumberOfTeams}
                keyboardType="number-pad"
              />
            </>
          ) : null}
        </View>
      </ScrollView>
      <View style={{ padding: spacing.lg }}>
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
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'phone-pad';
}) {
  return (
    <InputField
      label={label}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      multiline={multiline}
      keyboardType={keyboardType ?? 'default'}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  field: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textMuted },
  errorHint: {
    ...typography.caption,
    color: colors.danger,
    marginTop: 4,
    textAlign: 'right',
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pillRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 44,
    alignItems: 'center',
  },
  pillActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  pillText: { ...typography.body, color: colors.textMuted },
  pillTextActive: { color: colors.primary, fontWeight: '700' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
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
    textAlign: 'center',
  },
});
