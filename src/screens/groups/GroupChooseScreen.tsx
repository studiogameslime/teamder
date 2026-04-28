import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import type { GroupStackParamList } from '@/navigation/GroupStack';

type Nav = NativeStackNavigationProp<GroupStackParamList, 'GroupChoose'>;

export function GroupChooseScreen() {
  const nav = useNavigation<Nav>();

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name="people-outline" size={64} color={colors.primary} />
        </View>
        <Text style={styles.title}>{he.groupsChooseTitle}</Text>
        <Text style={styles.subtitle}>{he.groupsChooseSub}</Text>
      </View>
      <View style={styles.cta}>
        <Button
          title={he.groupsSearchTitle}
          variant="primary"
          size="lg"
          fullWidth
          iconLeft="search-outline"
          onPress={() => nav.navigate('GroupSearch')}
        />
        <Button
          title={he.groupsCreate}
          variant="outline"
          size="lg"
          fullWidth
          iconLeft="add-circle-outline"
          onPress={() => nav.navigate('GroupCreate')}
        />
        <Button
          title={he.groupsJoin}
          variant="outline"
          size="lg"
          fullWidth
          iconLeft="link-outline"
          onPress={() => nav.navigate('GroupJoin')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  cta: { gap: spacing.md, paddingBottom: spacing.lg },
});
