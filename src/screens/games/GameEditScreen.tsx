// Edit-game form. Loads the game by id, pre-fills the same fields as the
// create form, and patches via gameService.updateGameV2.
//
// Reuses the CreateGameScreen layout/visual language but is a separate
// component because the data lifecycle is different — initial state must
// hydrate from a network fetch instead of static defaults.

import React, { useEffect, useState } from 'react';
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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { InputField } from '@/components/InputField';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { gameService } from '@/services/gameService';
import { FieldType, Game, GameFormat } from '@/types';
import { AppDateTimeField } from '@/components/DateTimeFields';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'GameEdit'>;
type Route = RouteProp<GameStackParamList, 'GameEdit'>;

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

export function GameEditScreen() {
  const nav = useNavigation<Nav>();
  const { gameId } = useRoute<Route>().params;

  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);

  const [startsAt, setStartsAt] = useState<number>(Date.now());
  const [fieldName, setFieldName] = useState('');
  const [format, setFormat] = useState<GameFormat>('5v5');
  const [numberOfTeams, setNumberOfTeams] = useState<number>(2);
  const [minPlayers, setMinPlayers] = useState('');
  const [cancelDeadlineHours, setCancelDeadlineHours] = useState('');
  const [fieldType, setFieldType] = useState<FieldType | undefined>(undefined);
  const [matchDuration, setMatchDuration] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [bringBall, setBringBall] = useState(true);
  const [bringShirts, setBringShirts] = useState(true);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const g = await gameService.getGameById(gameId);
      if (!alive) return;
      if (!g) {
        setLoading(false);
        return;
      }
      setGame(g);
      setStartsAt(g.startsAt);
      setFieldName(g.fieldName);
      setFormat(g.format ?? '5v5');
      setNumberOfTeams(g.numberOfTeams ?? 2);
      setMinPlayers(g.minPlayers ? String(g.minPlayers) : '');
      setCancelDeadlineHours(
        g.cancelDeadlineHours ? String(g.cancelDeadlineHours) : '',
      );
      setFieldType(g.fieldType);
      setMatchDuration(
        g.matchDurationMinutes ? String(g.matchDurationMinutes) : '',
      );
      setIsPublic(!!g.isPublic);
      setRequiresApproval(!!g.requiresApproval);
      setBringBall(g.bringBall ?? true);
      setBringShirts(g.bringShirts ?? true);
      setNotes(g.notes ?? '');
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [gameId]);

  const maxPlayers = playersPerTeam(format) * numberOfTeams;
  const canSave = !busy && !!game && fieldName.trim().length > 0;

  const submit = async () => {
    if (!game || !canSave) return;
    setBusy(true);
    try {
      const parsedMin = parseInt(minPlayers, 10);
      const parsedDeadline = parseInt(cancelDeadlineHours, 10);
      const parsedDuration = parseInt(matchDuration, 10);
      await gameService.updateGameV2(game.id, {
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
          Number.isFinite(parsedDuration) && parsedDuration > 0
            ? parsedDuration
            : undefined,
        isPublic,
        requiresApproval,
        bringBall,
        bringShirts,
        notes: notes.trim() || undefined,
      });
      // Replace so the back button from MatchDetails returns to wherever
      // we came from (typically GamesList), not back to the edit form.
      nav.replace('MatchDetails', { gameId: game.id });
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.editGameTitle} />
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      </SafeAreaView>
    );
  }

  if (!game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.editGameTitle} />
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>{he.error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.editGameTitle} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <AppDateTimeField
            label={he.createGameDateTime}
            value={startsAt}
            onChange={setStartsAt}
          />

          <InputField
            label={he.createGameField}
            value={fieldName}
            onChangeText={setFieldName}
          />

          {/* Format pills */}
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

          {/* Number of teams */}
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
            <InputField
              label={he.createGameMinPlayers}
              value={minPlayers}
              onChangeText={setMinPlayers}
              keyboardType="number-pad"
            />
            <Text style={styles.hint}>{he.createGameMinPlayersHint}</Text>
          </View>

          {/* Field type */}
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
            <InputField
              label={he.createGameMatchDuration}
              value={matchDuration}
              onChangeText={setMatchDuration}
              keyboardType="number-pad"
            />
            <Text style={styles.hint}>{he.createGameMatchDurationHint}</Text>
          </View>

          <View>
            <InputField
              label={he.createGameCancelDeadline}
              value={cancelDeadlineHours}
              onChangeText={setCancelDeadlineHours}
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

          <InputField
            label={he.createGameNotes}
            value={notes}
            onChangeText={setNotes}
            placeholder="לדוגמה: שער דרומי, חניה ברחוב"
            multiline
          />
        </ScrollView>

        <View style={{ padding: spacing.lg }}>
          <Button
            title={he.editGameSubmit}
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
