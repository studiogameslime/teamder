// Create game-session form. The user lands here, fills in the essentials,
// and creates a session in ~10 seconds. Less common knobs are tucked
// behind an "advanced" accordion so they don't clutter the primary path.

import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { InputField } from '@/components/InputField';
import { gameService } from '@/services/gameService';
import { FieldType, GameFormat, Group } from '@/types';
import { AppDateTimeField } from '@/components/DateTimeFields';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'GameCreate'>;

const FORMATS: GameFormat[] = ['5v5', '6v6', '7v7'];
const TEAM_COUNTS = [2, 3, 4, 5] as const;

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

function playersPerTeam(f: GameFormat): number {
  return f === '5v5' ? 5 : f === '6v6' ? 6 : 7;
}

export function GameCreateScreen() {
  const nav = useNavigation<Nav>();
  const user = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);

  // Empty-community state — bounce out with a friendly message.
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
    [myCommunities, groupId],
  );

  const [startsAt, setStartsAt] = useState<number>(() => {
    // Default to next Thursday 20:00 — typical session slot.
    const d = new Date();
    const delta = (4 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + delta);
    d.setHours(20, 0, 0, 0);
    return d.getTime();
  });
  const [fieldName, setFieldName] = useState<string>(
    selectedGroup?.fieldName ?? '',
  );
  const [format, setFormat] = useState<GameFormat>('5v5');
  // Round duration default 8 min — the canonical "משחקון" length.
  const [roundDuration, setRoundDuration] = useState<string>('8');

  // Advanced (collapsed by default).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [numberOfTeams, setNumberOfTeams] = useState<number>(2);
  const [fieldType, setFieldType] = useState<FieldType | undefined>(undefined);
  const [minPlayers, setMinPlayers] = useState<string>('');
  const [cancelDeadlineHours, setCancelDeadlineHours] = useState<string>('');
  const [bringBall, setBringBall] = useState(true);
  const [bringShirts, setBringShirts] = useState(true);
  const [isPublic, setIsPublic] = useState(false);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);

  // Derived: total registrant capacity (format × team count).
  const maxPlayers = playersPerTeam(format) * numberOfTeams;

  const handleGroupChange = (id: string) => {
    setGroupId(id);
    const g = myCommunities.find((x) => x.id === id);
    if (g?.fieldName) setFieldName(g.fieldName);
  };

  const canSave =
    !busy && !!user && !!selectedGroup && fieldName.trim().length > 0;

  const submit = async () => {
    if (!user || !selectedGroup || !canSave) return;
    setBusy(true);
    try {
      const parsedMin = parseInt(minPlayers, 10);
      const parsedDeadline = parseInt(cancelDeadlineHours, 10);
      const parsedRound = parseInt(roundDuration, 10);
      const created = await gameService.createGameV2({
        groupId: selectedGroup.id,
        title: selectedGroup.name,
        startsAt,
        fieldName: fieldName.trim(),
        maxPlayers,
        minPlayers:
          Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : undefined,
        format,
        numberOfTeams,
        cancelDeadlineHours:
          Number.isFinite(parsedDeadline) && parsedDeadline > 0
            ? parsedDeadline
            : undefined,
        fieldType,
        matchDurationMinutes:
          Number.isFinite(parsedRound) && parsedRound > 0
            ? parsedRound
            : undefined,
        autoTeamGenerationMinutesBeforeStart: 60,
        isPublic,
        requiresApproval,
        bringBall,
        bringShirts,
        notes: notes.trim() || undefined,
        createdBy: user.id,
      });
      nav.replace('MatchDetails', { gameId: created.id });
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.createGameTitle} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* ─── Community select — only when more than one to pick from ── */}
          {myCommunities.length > 1 ? (
            <View style={styles.section}>
              <Text style={styles.label}>{he.createGameCommunity}</Text>
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
          ) : null}

          {/* ─── Date/time ────────────────────────────────────────────── */}
          <AppDateTimeField
            label={he.createGameDateTime}
            value={startsAt}
            onChange={setStartsAt}
          />

          {/* ─── Location ─────────────────────────────────────────────── */}
          <InputField
            label={he.createGameField}
            value={fieldName}
            onChangeText={setFieldName}
          />

          {/* ─── Format ───────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.label}>{he.createGameFormat}</Text>
            <View style={styles.pillRow}>
              {FORMATS.map((f) => (
                <Pressable
                  key={f}
                  onPress={() => setFormat(f)}
                  style={({ pressed }) => [
                    styles.pill,
                    format === f && styles.pillActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      format === f && styles.pillTextActive,
                    ]}
                  >
                    {formatLabel(f)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* ─── Match duration ───────────────────────────────────── */}
          <View>
            <InputField
              label={he.createGameMatchDuration}
              value={roundDuration}
              onChangeText={setRoundDuration}
              keyboardType="number-pad"
            />
            <Text style={styles.hint}>{he.createGameMatchDurationHint}</Text>
          </View>

          {/* ─── Total players (derived display) ───────────────────────── */}
          <View style={styles.totalRow}>
            <Ionicons name="people-outline" size={18} color={colors.primary} />
            <Text style={styles.totalText}>
              {he.createGameTotalShort(maxPlayers)}
            </Text>
          </View>

          {/* ─── Advanced accordion ─────────────────────────────────── */}
          <Pressable
            onPress={() => setAdvancedOpen((v) => !v)}
            style={({ pressed }) => [
              styles.advancedHeader,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.advancedTitle}>{he.createGameAdvanced}</Text>
            <Ionicons
              name={advancedOpen ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textMuted}
            />
          </Pressable>

          {advancedOpen ? (
            <View style={styles.advancedBody}>
              {/* Number of teams */}
              <View style={styles.section}>
                <Text style={styles.label}>{he.createGameNumberOfTeams}</Text>
                <View style={styles.pillRow}>
                  {TEAM_COUNTS.map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setNumberOfTeams(n)}
                      style={({ pressed }) => [
                        styles.pill,
                        numberOfTeams === n && styles.pillActive,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          numberOfTeams === n && styles.pillTextActive,
                        ]}
                      >
                        {String(n)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Field type */}
              <View style={styles.section}>
                <Text style={styles.label}>{he.createGameFieldType}</Text>
                <View style={styles.pillRow}>
                  {(['asphalt', 'synthetic', 'grass'] as const).map((f) => (
                    <Pressable
                      key={f}
                      onPress={() =>
                        setFieldType(fieldType === f ? undefined : f)
                      }
                      style={({ pressed }) => [
                        styles.pill,
                        fieldType === f && styles.pillActive,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          fieldType === f && styles.pillTextActive,
                        ]}
                      >
                        {fieldTypeLabel(f)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Min players */}
              <View>
                <InputField
                  label={he.createGameMinPlayers}
                  value={minPlayers}
                  onChangeText={setMinPlayers}
                  keyboardType="number-pad"
                />
                <Text style={styles.hint}>{he.createGameMinPlayersHint}</Text>
              </View>

              {/* Cancel deadline */}
              <View>
                <InputField
                  label={he.createGameCancelDeadline}
                  value={cancelDeadlineHours}
                  onChangeText={setCancelDeadlineHours}
                  keyboardType="number-pad"
                />
                <Text style={styles.hint}>
                  {he.createGameCancelDeadlineHint}
                </Text>
              </View>

              {/* Optional rules — toggles + free-text notes */}
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

              <InputField
                label={he.createGameNotes}
                value={notes}
                onChangeText={setNotes}
                placeholder="לדוגמה: שער דרומי, חניה ברחוב"
                multiline
              />
            </View>
          ) : null}
        </ScrollView>

        {/* ─── Sticky CTA ─────────────────────────────────────────────── */}
        <View style={styles.ctaWrap}>
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

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
        <Text style={styles.toggleLabel}>{label}</Text>
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
        <Ionicons name="ellipse-outline" size={22} color={colors.textMuted} />
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

  section: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textMuted },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  // Pill row used for format / number-of-teams / field-type pickers.
  pillRow: { flexDirection: 'row', gap: spacing.xs },
  pill: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  pillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  pillText: { ...typography.body, color: colors.textMuted },
  pillTextActive: { color: colors.primary, fontWeight: '600' },

  // Derived "total players" display — sits between the format pills and
  // the advanced accordion as a clear hint of capacity.
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  totalText: {
    ...typography.label,
    color: colors.primary,
    fontWeight: '700',
  },

  // Toggle row used in advanced.
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleLabel: { ...typography.body, color: colors.text, fontWeight: '500' },

  // Advanced accordion
  advancedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  advancedTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  advancedBody: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },

  // Community select (only shown if user is in 2+ groups)
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
  communitySub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Sticky CTA
  ctaWrap: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.bg,
  },

  // Empty state
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
