// Create-game form. Communities the user belongs to populate the select.
// Default location is pre-filled from the chosen community's fieldName so
// the typical "same field every week" path is one tap.

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { gameService } from '@/services/gameService';
import { FieldType, GameFormat, Group, SkillLevel } from '@/types';
import { AppDateTimeField } from '@/components/DateTimeFields';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'GameCreate'>;

const FORMATS: GameFormat[] = ['5v5', '6v6', '7v7'];
const TEAM_COUNTS = [2, 3, 4, 5] as const;
const SKILL_LEVELS: SkillLevel[] = [
  'beginner',
  'intermediate',
  'advanced',
  'mixed',
];

function fieldTypeLabel(f: FieldType): string {
  if (f === 'asphalt') return he.fieldTypeAsphalt;
  if (f === 'synthetic') return he.fieldTypeSynthetic;
  return he.fieldTypeGrass;
}

function formatLabel(f: GameFormat): string {
  if (f === '5v5') return he.gameFormat5;
  if (f === '6v6') return he.gameFormat6;
  return he.gameFormat7;
}

const SKILL_LABEL: Record<SkillLevel, string> = {
  beginner: he.skillBeginner,
  intermediate: he.skillIntermediate,
  advanced: he.skillAdvanced,
  mixed: he.skillMixed,
};

function playersPerTeam(f: GameFormat): number {
  return f === '5v5' ? 5 : f === '6v6' ? 6 : 7;
}

export function GameCreateScreen() {
  const nav = useNavigation<Nav>();
  const user = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);

  // Empty-community state — show a friendly message and bounce out.
  if (myCommunities.length === 0) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.createGameTitle} />
        <View style={styles.emptyAll}>
          <Ionicons name="people-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>{he.createGameNoCommunities}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const [groupId, setGroupId] = useState<string>(myCommunities[0].id);
  const selectedGroup = useMemo<Group | undefined>(
    () => myCommunities.find((g) => g.id === groupId),
    [myCommunities, groupId]
  );

  const [startsAt, setStartsAt] = useState<number>(() => {
    // Default to next Thursday, 20:00.
    const d = new Date();
    const delta = (4 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + delta);
    d.setHours(20, 0, 0, 0);
    return d.getTime();
  });
  const [fieldName, setFieldName] = useState<string>(
    selectedGroup?.fieldName ?? ''
  );
  const [format, setFormat] = useState<GameFormat>('5v5');
  const [numberOfTeams, setNumberOfTeams] = useState<number>(3);
  const [minPlayers, setMinPlayers] = useState<string>('');
  const [skillLevel, setSkillLevel] = useState<SkillLevel>(
    selectedGroup?.skillLevel ?? 'mixed'
  );
  const [cancelDeadlineHours, setCancelDeadlineHours] = useState<string>('');
  const [fieldType, setFieldType] = useState<FieldType | undefined>(undefined);
  const [matchDuration, setMatchDuration] = useState<string>('');
  const [autoBalanceMinutes, setAutoBalanceMinutes] = useState<number>(60);
  const [isPublic, setIsPublic] = useState(false);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [bringBall, setBringBall] = useState(true);
  const [bringShirts, setBringShirts] = useState(true);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Derived: maxPlayers is computed live from format × numberOfTeams.
  // No manual override — clearer mental model and prevents arithmetic
  // mistakes (e.g., 5v5 × 3 = 15, not "what feels right").
  const maxPlayers = playersPerTeam(format) * numberOfTeams;

  const handleGroupChange = (id: string) => {
    setGroupId(id);
    const g = myCommunities.find((x) => x.id === id);
    if (g?.fieldName) setFieldName(g.fieldName);
    if (g?.skillLevel) setSkillLevel(g.skillLevel);
  };

  const canSave =
    !busy && !!user && selectedGroup && fieldName.trim().length > 0;

  const submit = async () => {
    if (!user || !selectedGroup || !canSave) return;
    setBusy(true);
    try {
      const parsedMin = parseInt(minPlayers, 10);
      const parsedDeadline = parseInt(cancelDeadlineHours, 10);
      await gameService.createGameV2({
        groupId: selectedGroup.id,
        title: selectedGroup.name,
        startsAt,
        fieldName: fieldName.trim(),
        maxPlayers,
        minPlayers:
          Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : undefined,
        format,
        numberOfTeams,
        skillLevel,
        cancelDeadlineHours:
          Number.isFinite(parsedDeadline) && parsedDeadline > 0
            ? parsedDeadline
            : undefined,
        fieldType,
        matchDurationMinutes:
          (() => {
            const n = parseInt(matchDuration, 10);
            return Number.isFinite(n) && n > 0 ? n : undefined;
          })(),
        autoTeamGenerationMinutesBeforeStart: autoBalanceMinutes,
        isPublic,
        requiresApproval,
        bringBall,
        bringShirts,
        notes: notes.trim() || undefined,
        createdBy: user.id,
      });
      nav.goBack();
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.createGameTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Community select */}
        <View style={styles.field}>
          <Text style={styles.label}>{he.createGameCommunity}</Text>
          <Text style={styles.hint}>{he.createGameCommunityHint}</Text>
          <View style={styles.communityList}>
            {myCommunities.map((g) => (
              <CommunityRow
                key={g.id}
                group={g}
                selected={g.id === groupId}
                onSelect={() => handleGroupChange(g.id)}
              />
            ))}
          </View>
        </View>

        <AppDateTimeField
          label={he.createGameDateTime}
          value={startsAt}
          onChange={setStartsAt}
        />
        <Field
          label={he.createGameField}
          value={fieldName}
          onChange={setFieldName}
        />

        {/* Format picker — pill row */}
        <View style={styles.field}>
          <Text style={styles.label}>{he.createGameFormat}</Text>
          <View style={styles.formatRow}>
            {FORMATS.map((f) => (
              <Pressable
                key={f}
                onPress={() => setFormat(f)}
                style={({ pressed }) => [
                  styles.formatPill,
                  format === f && styles.formatPillActive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text
                  style={[
                    styles.formatPillText,
                    format === f && {
                      color: colors.primary,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {formatLabel(f)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Number of teams (2–5) — pill row. maxPlayers is derived. */}
        <View style={styles.field}>
          <Text style={styles.label}>{he.createGameNumberOfTeams}</Text>
          <View style={styles.formatRow}>
            {TEAM_COUNTS.map((n) => (
              <Pressable
                key={n}
                onPress={() => setNumberOfTeams(n)}
                style={({ pressed }) => [
                  styles.formatPill,
                  numberOfTeams === n && styles.formatPillActive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text
                  style={[
                    styles.formatPillText,
                    numberOfTeams === n && {
                      color: colors.primary,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {String(n)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.totalText}>
            {he.createGameTotalPlayers(maxPlayers)}
          </Text>
        </View>

        <View>
          <Field
            label={he.createGameMinPlayers}
            value={minPlayers}
            onChange={setMinPlayers}
            keyboardType="number-pad"
          />
          <Text style={styles.hint}>{he.createGameMinPlayersHint}</Text>
        </View>

        {/* Skill level pills */}
        <View style={styles.field}>
          <Text style={styles.label}>{he.createGameSkillLevel}</Text>
          <View style={styles.formatRow}>
            {SKILL_LEVELS.map((s) => (
              <Pressable
                key={s}
                onPress={() => setSkillLevel(s)}
                style={({ pressed }) => [
                  styles.formatPill,
                  skillLevel === s && styles.formatPillActive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text
                  style={[
                    styles.formatPillText,
                    skillLevel === s && {
                      color: colors.primary,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {SKILL_LABEL[s]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View>
          <Text style={styles.label}>{he.createGameFieldType}</Text>
          <View style={styles.formatRow}>
            {(['asphalt', 'synthetic', 'grass'] as const).map((f) => (
              <Pressable
                key={f}
                onPress={() => setFieldType(fieldType === f ? undefined : f)}
                style={({ pressed }) => [
                  styles.formatPill,
                  fieldType === f && styles.formatPillActive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text
                  style={[
                    styles.formatPillText,
                    fieldType === f && {
                      color: colors.primary,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {fieldTypeLabel(f)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View>
          <Field
            label={he.createGameMatchDuration}
            value={matchDuration}
            onChange={setMatchDuration}
            keyboardType="number-pad"
          />
          <Text style={styles.hint}>{he.createGameMatchDurationHint}</Text>
        </View>

        <View>
          <Text style={styles.label}>{he.createGameAutoBalanceTiming}</Text>
          <View style={styles.formatRow}>
            {(
              [
                { v: 30, label: he.createGameAutoBalance30 },
                { v: 60, label: he.createGameAutoBalance60 },
                { v: 120, label: he.createGameAutoBalance120 },
              ] as const
            ).map((opt) => (
              <Pressable
                key={opt.v}
                onPress={() => setAutoBalanceMinutes(opt.v)}
                style={({ pressed }) => [
                  styles.formatPill,
                  autoBalanceMinutes === opt.v && styles.formatPillActive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text
                  style={[
                    styles.formatPillText,
                    autoBalanceMinutes === opt.v && {
                      color: colors.primary,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View>
          <Field
            label={he.createGameCancelDeadline}
            value={cancelDeadlineHours}
            onChange={setCancelDeadlineHours}
            keyboardType="number-pad"
          />
          <Text style={styles.hint}>{he.createGameCancelDeadlineHint}</Text>
        </View>

        <ToggleRow
          label={he.createGameIsPublic}
          hint={he.createGameIsPublicHint}
          value={isPublic}
          onChange={setIsPublic}
        />
        <ToggleRow
          label={he.createGameRequiresApproval}
          hint={he.createGameRequiresApprovalHint}
          value={requiresApproval}
          onChange={setRequiresApproval}
        />
        <ToggleRow
          label={he.createGameBringBall}
          value={bringBall}
          onChange={setBringBall}
        />
        <ToggleRow
          label={he.createGameBringShirts}
          value={bringShirts}
          onChange={setBringShirts}
        />

        <Field
          label={he.createGameNotes}
          value={notes}
          onChange={setNotes}
          placeholder="לדוגמה: שער דרומי, חניה ברחוב"
          multiline
        />
      </ScrollView>

      <View style={{ padding: spacing.lg }}>
        <Button
          title={he.createGameSubmit}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSave}
          loading={busy}
          onPress={submit}
        />
      </View>
    </SafeAreaView>
  );
}

// ─── Helpers + sub-components ──────────────────────────────────────────────

function formatDateInput(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

function parseDateInput(s: string): number | null {
  // Accept "DD/MM/YYYY HH:mm" — same shape we render in the placeholder.
  const m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/
  );
  if (!m) return null;
  const [, dd, mm, yy, hh, mi] = m;
  const d = new Date(
    Number(yy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    0,
    0
  );
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
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
  keyboardType?: 'default' | 'number-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          multiline && { minHeight: 80, textAlignVertical: 'top' },
        ]}
        textAlign="right"
        multiline={multiline}
        keyboardType={keyboardType}
      />
    </View>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
      />
    </View>
  );
}

function CommunityRow({
  group,
  selected,
  onSelect,
}: {
  group: Group;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        styles.communityRow,
        selected && styles.communityRowSelected,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.communityName}>{group.name}</Text>
        <Text style={styles.communitySub}>{group.fieldName}</Text>
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
      ) : (
        <Ionicons
          name="ellipse-outline"
          size={22}
          color={colors.textMuted}
        />
      )}
    </Pressable>
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
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
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

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },

  formatRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  formatPill: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  formatPillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  formatPillText: { ...typography.body, color: colors.textMuted },
  totalText: {
    ...typography.label,
    color: colors.primary,
    textAlign: 'right',
    marginTop: spacing.xs,
    fontWeight: '700',
  },

  communityList: { gap: spacing.xs, marginTop: spacing.xs },
  communityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  communityRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  communityName: { ...typography.bodyBold, color: colors.text },
  communitySub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  emptyAll: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
