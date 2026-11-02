import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonRegion, SkeletonBlock as Block } from './ScreenSkeletons';

function Tabs({ count = 4 }: { count?: number }) {
  return <View style={s.row}>{Array.from({ length: count }, (_, i) => <Block key={i} style={{ flex: 1, height: 34, borderRadius: 10 }} />)}</View>;
}

function IdentityRows({ count = 3 }: { count?: number }) {
  return <View style={s.card}>{Array.from({ length: count }, (_, i) => <View key={i} style={[s.identityRow, i > 0 && s.divider]}>
    <Block style={{ width: 38, height: 38, borderRadius: 19 }} />
    <View style={s.body}><Block style={{ width: i % 2 ? '62%' : '82%', height: 15 }} /><Block style={{ width: '44%', height: 11 }} /></View>
    <Block style={{ width: 32, height: 20 }} />
  </View>)}</View>;
}

export function MatchDetailsSkeleton() {
  return <SkeletonRegion label="טוענים את פרטי המחזור">
    <View style={s.card}>
      <Block style={{ height: 158, borderRadius: 0, backgroundColor: '#E7EEF8' }} />
      <View style={s.cardBody}>
        <Block style={{ width: '70%', height: 24 }} />
        <View style={s.row}><Block style={{ flex: 1, height: 13 }} /><Block style={{ width: 76, height: 24, borderRadius: 12 }} /></View>
        <Block style={{ height: 44, borderRadius: 12 }} />
      </View>
    </View>
    <Tabs />
    <Block style={{ width: '45%', height: 20, marginTop: 4 }} />
    <IdentityRows />
  </SkeletonRegion>;
}

export function ClubDetailsSkeleton() {
  return <SkeletonRegion label="טוענים את פרטי המועדון">
    <View style={s.card}>
      <Block style={{ height: 146, borderRadius: 0, backgroundColor: '#E7EEF8' }} />
      <View style={s.cardBody}><Block style={{ width: '66%', height: 24 }} /><Block style={{ width: '42%', height: 12 }} /></View>
    </View>
    <Tabs count={3} />
    <View style={[s.card, s.cardBody]}>
      <Block style={{ width: '55%', height: 19 }} />
      <Block style={{ height: 82, borderRadius: 12 }} />
      <View style={s.row}>{[0, 1, 2, 3].map(i => <Block key={i} style={{ width: 38, height: 38, borderRadius: 19 }} />)}</View>
      <Block style={{ width: '80%', height: 12 }} />
    </View>
  </SkeletonRegion>;
}

export function PersonalStatisticsSkeleton() {
  return <SkeletonRegion label="טוענים את הסטטיסטיקה האישית">
    <View style={[s.card, s.cardBody]}>
      <View style={s.row}>
        <Block style={{ width: 58, height: 58, borderRadius: 29 }} />
        <View style={s.body}><Block style={{ width: '70%', height: 22 }} /><Block style={{ width: '45%', height: 12 }} /></View>
      </View>
      <View style={[s.row, { paddingVertical: 14 }]}>{[0, 1, 2].map(i => <View key={i} style={s.metric}>
        <Block style={{ width: 30, height: 30, borderRadius: 15 }} /><Block style={{ width: 48, height: 28 }} /><Block style={{ width: 54, height: 11 }} />
      </View>)}</View>
      <Block style={{ width: '48%', height: 18 }} />
      <View style={s.chart}>{[40, 68, 48, 88, 64].map((height, i) => <Block key={i} style={{ flex: 1, height, borderRadius: 6 }} />)}</View>
      <Block style={{ width: '75%', height: 12 }} />
    </View>
    <View style={[s.card, s.cardBody]}><Block style={{ width: '52%', height: 19 }} /><Block style={{ width: '86%', height: 12 }} /><Block style={{ height: 62, borderRadius: 12 }} /></View>
  </SkeletonRegion>;
}

/** Same row geometry as conversations and the new-conversation friend picker. */
export function ConversationListSkeleton({ kind = 'chats', count = 5 }: { kind?: 'chats' | 'friends'; count?: number }) {
  return <SkeletonRegion label={kind === 'chats' ? 'טוענים את השיחות שלך' : 'טוענים את החברים שלך'}>
    {Array.from({ length: count }, (_, i) => <View key={i} style={[s.card, s.conversationRow]}>
      <Block style={{ width: 50, height: 50, borderRadius: 25 }} />
      <View style={s.body}><Block style={{ width: i % 2 ? '64%' : '82%', height: 16 }} /><Block style={{ width: '94%', height: 12 }} />
        {kind === 'chats' ? <Block style={{ width: '44%', height: 10 }} /> : null}</View>
      <View style={{ gap: 12, alignItems: 'center' }}><Block style={{ width: 27, height: 11 }} /><Block style={{ width: 19, height: 19, borderRadius: 10 }} /></View>
    </View>)}
  </SkeletonRegion>;
}

export function FriendsListSkeleton() {
  return <ConversationListSkeleton kind="friends" />;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E4ECF9', overflow: 'hidden' },
  cardBody: { padding: 16, gap: 14 },
  body: { flex: 1, minWidth: 0, gap: 9 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 66, paddingHorizontal: 14, paddingVertical: 10 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ECF1F8' },
  metric: { flex: 1, alignItems: 'center', gap: 7 },
  chart: { height: 110, flexDirection: 'row', alignItems: 'flex-end', gap: 14, paddingHorizontal: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#E7EEF7' },
  conversationRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 88 },
});
