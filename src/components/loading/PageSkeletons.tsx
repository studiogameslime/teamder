import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonRegion, SkeletonBlock as Block } from './ScreenSkeletons';

function Tabs({ count }: { count: number }) {
  return <View style={s.tabs}>{Array.from({ length: count }, (_, i) => <View key={i} style={s.tab}><Block style={{ width: '65%', height: 18 }} /></View>)}</View>;
}

/** Both real stadium headers have a 230-point photo, followed by flush tabs. */
function Stadium({ club = false }: { club?: boolean }) {
  return <View style={s.stadium}>
    <Block style={{ width: club ? 110 : 92, height: 28, borderRadius: 18 }} />
    <View style={{ gap: 10 }}>
      <Block style={{ width: '76%', height: 32 }} />
      <Block style={{ width: '56%', height: 20 }} />
      {!club ? <Block style={{ width: '65%', height: 20 }} /> : null}
      <View style={s.row}><Block style={{ flex: 1, height: 20 }} /><Block style={{ width: 102, height: 27, borderRadius: 18 }} /></View>
    </View>
  </View>;
}

export function MatchDetailsSkeleton() {
  return <SkeletonRegion label="טוענים את פרטי המחזור" gap={0}>
    <Stadium />
    <Tabs count={4} />
    <View style={s.detailBody}>
      <View style={[s.card, s.cardBody]}>
        <View style={s.row}><Block style={{ flex: 1, height: 42 }} /><Block style={{ flex: 1, height: 42 }} /></View>
        <View style={s.row}><Block style={{ flex: 1, height: 42 }} /><Block style={{ flex: 1, height: 42 }} /></View>
      </View>
      <View style={[s.card, s.cardBody]}><Block style={{ width: '46%', height: 21 }} /><Block style={{ height: 92, borderRadius: 12 }} /></View>
    </View>
  </SkeletonRegion>;
}

export function ClubDetailsSkeleton() {
  return <SkeletonRegion label="טוענים את פרטי המועדון" gap={0}>
    <Stadium club />
    <Tabs count={3} />
    <View style={s.detailBody}>
      <View style={[s.card, s.cardBody]}><Block style={{ width: '55%', height: 21 }} /><Block style={{ width: '94%', height: 17 }} /><Block style={{ width: '77%', height: 17 }} /></View>
      <View style={[s.card, s.cardBody]}><Block style={{ width: '48%', height: 21 }} /><View style={s.row}>{[0, 1, 2].map(i => <View key={i} style={s.metric}><Block style={{ width: 32, height: 32 }} /><Block style={{ width: 42, height: 28 }} /><Block style={{ width: '80%', height: 14 }} /></View>)}</View></View>
    </View>
  </SkeletonRegion>;
}

export function PersonalStatisticsSkeleton() {
  return <SkeletonRegion label="טוענים את הסטטיסטיקה האישית">
    <View style={s.identity}>
      <Block style={{ width: 64, height: 64, borderRadius: 32 }} />
      <View style={s.body}><Block style={{ width: '76%', height: 27 }} /><Block style={{ width: '90%', height: 16 }} /></View>
    </View>
    <View style={s.numbers}>
      <View style={s.row}>{[0, 1, 2].map(i => <View key={i} style={s.metric}>
        <Block style={{ width: 25, height: 25 }} /><Block style={{ width: 48, height: 43 }} /><Block style={{ width: 54, height: 16 }} />
      </View>)}</View>
      <Block style={{ width: '82%', height: 16, alignSelf: 'center', marginTop: 10 }} />
    </View>
    <View style={[s.card, { padding: 12, gap: 8 }]}>
      <View style={s.row}><View style={s.body}><Block style={{ width: '72%', height: 22 }} /><Block style={{ width: '85%', height: 18 }} /></View><Block style={{ width: 82, height: 25, borderRadius: 14 }} /></View>
      <View style={s.row}><Block style={{ width: '35%', height: 17 }} /><Block style={{ width: '35%', height: 17 }} /></View>
      <Block style={{ height: 145, borderRadius: 6 }} />
      <Block style={{ width: '45%', height: 14, alignSelf: 'center' }} />
    </View>
    <View style={[s.card, s.cardBody]}><Block style={{ width: '54%', height: 23 }} /><View style={s.row}>{[0, 1, 2].map(i => <View key={i} style={s.metric}><Block style={{ width: 32, height: 27 }} /><Block style={{ width: '85%', height: 16 }} /></View>)}</View></View>
  </SkeletonRegion>;
}

/** Same 50-point avatar and 15-point vertical padding as ChatInbox rows. */
export function ConversationListSkeleton({ kind = 'chats', count = 5 }: { kind?: 'chats' | 'friends'; count?: number }) {
  return <SkeletonRegion label={kind === 'chats' ? 'טוענים את השיחות שלך' : 'טוענים את החברים שלך'} gap={9}>
    {Array.from({ length: count }, (_, i) => <View key={i} style={[s.card, s.conversationRow]}>
      <Block style={{ width: 50, height: 50, borderRadius: kind === 'chats' ? 15 : 25 }} />
      <View style={[s.body, { gap: 4 }]}><Block style={{ width: i % 2 ? '64%' : '82%', height: 18 }} /><Block style={{ width: '94%', height: 15 }} />
        {kind === 'chats' ? <Block style={{ width: '44%', height: 12 }} /> : null}</View>
      {kind === 'chats' ? <View style={{ gap: 7, alignItems: 'center' }}><Block style={{ width: 27, height: 12 }} /><Block style={{ width: 20, height: 20, borderRadius: 10 }} /></View> : <Block style={{ width: 23, height: 23, borderRadius: 10 }} />}
    </View>)}
  </SkeletonRegion>;
}

/** FriendsScreen has section headings and plain 44-point avatar rows. */
export function FriendsListSkeleton() {
  return <SkeletonRegion label="טוענים את החברים וההזמנות" gap={8}>
    <Block style={{ width: '43%', height: 22, marginBottom: 8 }} />
    {[0, 1, 2, 3, 4].map(i => <View key={i} style={s.friendRow}>
      <Block style={{ width: 44, height: 44, borderRadius: 22 }} />
      <Block style={{ flex: 1, height: 19, marginEnd: 18 }} />
      <Block style={{ width: 20, height: 20, borderRadius: 10 }} />
    </View>)}
  </SkeletonRegion>;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 17, borderWidth: 1, borderColor: '#E8EEF7', overflow: 'hidden' },
  cardBody: { padding: 14, gap: 14 },
  body: { flex: 1, minWidth: 0, gap: 5 },
  detailBody: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 12 },
  stadium: { minHeight: 230, padding: 16, gap: 10, justifyContent: 'space-between', borderRadius: 20, backgroundColor: '#E7EEF8', overflow: 'hidden' },
  tabs: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E8EEF7' },
  tab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  identity: { paddingHorizontal: 14, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 14 },
  numbers: { paddingVertical: 13, paddingHorizontal: 8, borderRadius: 15, backgroundColor: '#D8E8FF', overflow: 'hidden' },
  metric: { flex: 1, alignItems: 'center', gap: 6 },
  conversationRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 15, borderRadius: 16 },
  friendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FFFFFF', borderRadius: 16 },
});
