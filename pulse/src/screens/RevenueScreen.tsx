import React from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, font } from '../theme';
import { useDashboard } from '../state/DashboardContext';
import { Card, Empty, Screen, SectionHeader, StatTile } from '../components/ui';
import { Bars } from '../components/Chart';
import { BarList } from '../components/BarList';
import { compact, money } from '../format';

export function RevenueScreen() {
  const { snapshot, refreshing, refresh } = useDashboard();
  const nav = useNavigation<any>();
  const rev = snapshot.revenue;
  const best = rev?.adUnits?.[0];

  return (
    <Screen
      title="הכנסות"
      subtitle="AdMob"
      onBack={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('Overview'))}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
      }
    >
      {!rev ? (
        <Empty text="אין עדיין נתוני AdMob" />
      ) : (
        <>
          {/* All-time total — the headline number, most prominent on top. */}
          <Card style={styles.hero}>
            <Text style={styles.heroLabel}>💰 רווח כולל · כל הזמנים</Text>
            <Text style={styles.heroValue}>{money(rev.allTime ?? rev.last28, rev.currency)}</Text>
          </Card>

          <View style={styles.row}>
            <StatTile label="היום" value={money(rev.today, rev.currency)} tone="green" />
            <StatTile label="7 ימים" value={money(rev.last7, rev.currency)} />
            <StatTile label="28 ימים" value={money(rev.last28, rev.currency)} />
          </View>

          {best ? (
            <Card style={styles.best}>
              <Text style={styles.bestLabel}>🏆 המודעה הכי רווחית (28 ימים)</Text>
              <Text style={styles.bestName}>{best.name}</Text>
              <Text style={styles.bestValue}>
                {money(best.earnings, rev.currency)}
                <Text style={styles.bestSub}>
                  {'  ·  '}eCPM {money(best.ecpm, rev.currency)} · {compact(best.impressions)} חשיפות
                </Text>
              </Text>
            </Card>
          ) : null}

          <SectionHeader>הכנסה יומית (28 ימים)</SectionHeader>
          <Card>
            <Bars data={rev.daily} color={colors.green} height={110} />
          </Card>

          <View style={styles.row}>
            <StatTile label="חשיפות (7ימ׳)" value={compact(rev.impressions7)} />
            <StatTile label="קליקים (7ימ׳)" value={compact(rev.clicks7)} />
            <StatTile label="CTR (7ימ׳)" value={(rev.ctr7 * 100).toFixed(2) + '%'} />
          </View>
          <View style={styles.row}>
            <StatTile label="eCPM (7ימ׳)" value={money(rev.ecpm7, rev.currency)} />
          </View>

          {rev.adUnits.length ? (
            <>
              <SectionHeader>הכנסה לפי יחידת מודעה</SectionHeader>
              <Card>
                <BarList
                  data={rev.adUnits.map((a) => ({ name: a.name, value: a.earnings }))}
                  color={colors.green}
                  format={(n) => money(n, rev.currency)}
                />
              </Card>
            </>
          ) : null}

          {rev.byCountry.length ? (
            <>
              <SectionHeader>הכנסה לפי מדינה</SectionHeader>
              <Card>
                <BarList
                  data={rev.byCountry}
                  color={colors.primary}
                  format={(n) => money(n, rev.currency)}
                />
              </Card>
            </>
          ) : null}

          <Text style={styles.note}>
            * ערכים מוערכים מ־AdMob; התשלום הסופי עשוי להשתנות.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.green,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 22,
  },
  heroLabel: { ...font.small, color: colors.green, fontWeight: '700' },
  heroValue: { ...font.big, fontSize: 38, color: colors.green },
  row: { flexDirection: 'row', gap: 12 },
  best: { backgroundColor: colors.surfaceAlt, borderColor: colors.green, gap: 4 },
  bestLabel: { ...font.small, color: colors.green },
  bestName: { ...font.title, fontSize: 16 },
  bestValue: { ...font.big, fontSize: 22, color: colors.green },
  bestSub: { ...font.small, color: colors.textMuted, fontWeight: '500' },
  note: { ...font.small, color: colors.textMuted, marginTop: 4 },
});
