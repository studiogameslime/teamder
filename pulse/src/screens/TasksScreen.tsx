import { observeCaughtError } from '../services/errorObservation';
import { Dropdown } from '../components/Dropdown';
import { boardBuckets, boardSections, type BoardTab } from '../services/workBoard';
import { timeAgo } from '../format';
import { navRef } from '../navigation/navRef';
import { DiagnosticTimeline } from '../components/DiagnosticTimeline';
// TasksScreen — the app's home, and the ONE place all work lives.
//
// It used to show only the `tasks` collection, while errors, user reports,
// feature notes and ideas each had their own screen with its own status
// vocabulary. So "what's open?" had five answers and "go over the open items"
// meant remembering five places. Now every stream is normalised by
// ../services/workItems and rendered here as one list. Nothing was migrated —
// each item still lives in its own collection and every other screen still
// works; the merge happens on read.
//
// THREE TABS, and the middle one is the reason for the change:
//   פתוחות        — nobody has finished it.
//   בוצע ע״י רובנס — Claude finished it, wrote down what changed and attached
//                   proof. Still open everywhere else; it is waiting for the
//                   owner to read it and accept. THIS is the review queue.
//   בוצע          — the owner accepted it.
//
// Speed still matters: this replaced a dashboard that opened on four heavy
// network calls. Tasks paint from an on-disk snapshot first, and the remaining
// streams share the same caches the old screens used, so nothing here costs a
// read that wasn't already being paid.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RtlTextInput as TextInput } from '../components/RtlTextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { RTL_LABEL_ALIGN, colors, font, radius  } from '../theme';
import { Empty } from '../components/ui';
import { TeamderChatSheet } from '../components/TeamderChatSheet';
import { listAwaitingReply } from '../services/teamderChatService';
import {
  PRIORITIES,
  PRIORITY_LABEL,
  createTask,
  loadCachedTasks,
  removeTask,
  updateTask,
  type TaskCategory,
  type TaskPriority,
} from '../services/tasksService';
import { createIdea, setIdeaStatus, deleteIdea } from '../services/ideasService';
import {
  KIND_ICON,
  KIND_LABEL,
  KIND_ORDER,
  closeItem,
  listWorkSnapshot,
  retainFailedWork,
  STREAM_LABEL,
  type WorkStream,
  reopenItem,
  invalidateStream,
  loadItemImages,
  type WorkItem,
  type WorkKind,
} from '../services/workItems';
import { clearDoneByClaude } from '../services/claudeWork';
import { ImageLightbox, useLightbox } from '../components/ImageLightbox';

const MAX_IMAGES = 3;
const dataUri = (b64: string) => `data:image/jpeg;base64,${b64}`;

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  high: colors.red,
  normal: colors.textSoft,
  low: colors.textMuted,
};

type Tab = BoardTab;
const TAB_LABEL: Record<Tab, string> = {
  open: 'פתוחות',
  claude: 'בוצע ע״י רובנס',
  // "סגורות", not "בוצע" — the tab holds anything that left the list, and it
  // gets emptied periodically rather than kept as a permanent archive.
  done: 'סגורות',
};

/** Tag filter — `all` plus one chip per kind. */
type Filter = 'all' | WorkKind;

export function TasksScreen({initialTab='open',initialFilter='all'}:{initialTab?:BoardTab;initialFilter?:Filter} = {}) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [failedStreams, setFailedStreams] = useState<WorkStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rowLimit, setRowLimit] = useState(40);
  const [newest, setNewest] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [search, setSearch] = useState('');
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<WorkItem | null>(null);
  const [replyTo, setReplyTo] = useState<WorkItem | null>(null);
  const [openThread, setOpenThread] = useState<{ id: string; name: string } | null>(null);
  // One viewer for the whole screen rather than one per row — a row can be
  // unmounted by a re-sort while its image is open.
  const lightbox = useLightbox();

  // Paint from the tasks snapshot first — it is the only stream mirrored to
  // disk, but it is also the one the owner types into, so the screen is never
  // blank while the other four are in flight.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cachedTasks = await loadCachedTasks();
      if (alive && cachedTasks.length) {
        setItems(
          cachedTasks.map((t) => ({
            key: `task:${t.id}`,
            stream: 'task' as const,
            sourceReportId: t.source === 'teamder' && t.sourceId && !t.sourceId.includes('/') ? t.sourceId : undefined,
            kind: (t.category === 'ui'
              ? 'ui'
              : t.category === 'feature'
                ? 'feature'
                : 'bug') as WorkKind,
            id: t.id,
            docPath: `tasks/${t.id}`,
            title: t.title,
            body: t.notes,
            images: t.images,
            state: t.status === 'done' ? ('done' as const) : ('open' as const),
            claude: null,
            createdAt: t.createdAt,
            priority: t.priority,
            screen: t.screen,
            reporterId: t.reporterId,
            reporterName: t.reporterName,
            count: 1,
            claudeMayAct: true,
            hint: '',
          })),
        );
        setLoading(false);
      }
      try {
        const fresh = await listWorkSnapshot(false, partial => {
          if (alive) setItems(previous => [...partial, ...previous.filter(item => !partial.some(row => row.key === item.key))]);
        });
        if (alive) { setItems(previous => retainFailedWork(previous, fresh)); setFailedStreams(fresh.failedStreams); }
      } catch (caughtErrora2f62e5898) {
    observeCaughtError(caughtErrora2f62e5898, {"source":"pulse/src/screens/TasksScreen.tsx","handler":"TasksScreen","site":"TasksScreen:a2f62e5898"});
        if (alive) setFailedStreams(['task', 'error', 'report', 'feature', 'idea', 'chat']);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(async (force = true) => {
    setRefreshing(true);
    try {
      const result = await listWorkSnapshot(force);
      setItems(previous => retainFailedWork(previous, result));
      setFailedStreams(result.failedStreams);
    } catch (caughtErrorc01e9f63cc) {
    observeCaughtError(caughtErrorc01e9f63cc, {"source":"pulse/src/screens/TasksScreen.tsx","handler":"TasksScreen","site":"TasksScreen:c01e9f63cc"});
      setFailedStreams(['task', 'error', 'report', 'feature', 'idea', 'chat']);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(()=>setRowLimit(40),[tab,filter,search,newest]);

  const byState = useMemo(() => boardBuckets(items), [items]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return byState[tab].filter(item => (filter === 'all' || item.kind === filter) && (!query || [item.title, item.body, item.reporterName, item.screen].some(value => value.toLowerCase().includes(query))));
  }, [byState, tab, filter, search]);

  const groups = useMemo(() => boardSections(visible, newest), [visible, newest]);

  /** Counts per KIND inside the CURRENT tab — drives the filter chips. */
  const kindCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const i of byState[tab]) out[i.kind] = (out[i.kind] ?? 0) + 1;
    return out;
  }, [byState, tab]);

  const savingItems = useRef(new Set<string>());
  const saveState = async (item: WorkItem, reopen: boolean) => {
    if (savingItems.current.has(item.key)) return;
    savingItems.current.add(item.key);
    try {
      const ok = await (reopen ? reopenItem(item) : closeItem(item));
      if (!ok) throw new Error('SAVE_FAILED');
      setItems(previous => previous.map(i => i.key === item.key ? {...i, state: reopen ? (i.claude ? 'claude' : 'open') : 'done'} : i));
    } catch (caughtErrord7a862a39e) {
    observeCaughtError(caughtErrord7a862a39e, {"source":"pulse/src/screens/TasksScreen.tsx","handler":"saveState","site":"TasksScreen:d7a862a39e"}); Alert.alert('השינוי לא נשמר', 'הפריט נשאר במצבו הקודם. נסו שוב.'); }
    finally { savingItems.current.delete(item.key); }
  };
  const accept = (item: WorkItem) => saveState(item, false);
  const reopen = (item: WorkItem) => saveState(item, true);

  /** Withdraw Claude's handover — the item goes back to plain open. */
  const withdraw = async (item: WorkItem) => {
    try {
      if (!await clearDoneByClaude(item.docPath)) throw Error('SAVE_FAILED');
      setItems(prev=>prev.map(i=>i.key===item.key?{...i,state:'open',claude:null}:i));
      invalidateStream(item.stream);
    } catch (caughtErroreaa31c1909) {
    observeCaughtError(caughtErroreaa31c1909, {"source":"pulse/src/screens/TasksScreen.tsx","handler":"withdraw","site":"TasksScreen:eaa31c1909"}); Alert.alert('השינוי לא נשמר','המשימה עדיין ממתינה לאישור. נסו שוב.'); }
  };

  const setPriority = async (item: WorkItem, p: TaskPriority) => {
    if (item.stream !== 'task') return;
    setItems((prev) => prev.map((i) => (i.key === item.key ? { ...i, priority: p } : i)));
    await updateTask(item.id, { priority: p }, Date.now()).catch((caughtErrorc073a9314f: unknown) => {
    observeCaughtError(caughtErrorc073a9314f, {"source":"pulse/src/screens/TasksScreen.tsx","handler":"setPriority","site":"TasksScreen:c073a9314f"});});
  };

  const destroy = (item: WorkItem) => {
    Alert.alert('למחוק את המשימה?', item.title, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          setItems((prev) => prev.filter((i) => i.key !== item.key));
          try {if(!await (item.stream==='idea'?deleteIdea(item.id):removeTask(item.id)))throw Error();await reload(true);}catch (caughtErrorbb3a0ff2fc){
    observeCaughtError(caughtErrorbb3a0ff2fc, {"source":"pulse/src/screens/TasksScreen.tsx","handler":"onPress","site":"TasksScreen:bb3a0ff2fc"});Alert.alert('המחיקה נכשלה','הרשימה תרוענן כדי להציג את המצב שנשמר.');await reload(true);}
        },
      },
    ]);
  };

  const emptyText =
    tab === 'open'
      ? 'אין שום דבר פתוח 🎉'
      : tab === 'claude'
        ? 'רובנס עוד לא סיים כלום שממתין לאישור'
        : 'עוד לא אושר כלום';

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <View style={st.headerRow}>
          <View><Text style={{ ...font.h1,textAlign: RTL_LABEL_ALIGN}}>משימות</Text><Text style={{ ...font.small,textAlign: RTL_LABEL_ALIGN}}>כל העבודה במקום אחד</Text></View>
          <Pressable
            onPress={() => setComposing(true)}
            style={({ pressed }) => [st.addBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="add" size={20} color={colors.onPrimary} />
            <Text style={st.addBtnTxt}>חדש</Text>
          </Pressable>
        </View>

        <View style={{flexDirection:'row',direction:'rtl',alignItems:'center',gap:8,marginTop:16,backgroundColor:colors.surface,borderRadius:12,borderWidth:1,borderColor:colors.border,paddingHorizontal:12}}><Ionicons name="search-outline" size={20} color={colors.textMuted}/><TextInput value={search} onChangeText={setSearch} placeholder="חיפוש משימה, משתמש או מסך" placeholderTextColor={colors.textMuted} accessibilityLabel="חיפוש בתור העבודה" style={{ ...font.body,textAlign: RTL_LABEL_ALIGN,flex:1,minWidth:0,minHeight:46}} /></View>
        <View style={st.tabs}>
          {(['open', 'claude', 'done'] as Tab[]).map((k) => {
            const on = tab === k;
            const n = byState[k].length;
            return (
              <Pressable accessibilityRole="tab" accessibilityState={{selected:on}} key={k} onPress={() => {setTab(k);setFilter('all')}} style={[st.tab, k==='claude' && {flex:1.8}, on && st.tabOn]}>
                <Text style={[st.tabTxt, on && st.tabTxtOn]} numberOfLines={1}>
                  {TAB_LABEL[k]}
                </Text>
                <Text style={[st.tabTxt,on && st.tabTxtOn]}>{n}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{flexDirection:'row',direction:'rtl',gap:8,paddingVertical:12}}>
          <Dropdown flex={1} title="סוג משימה" value={filter} options={[{value:'all',label:'כל הסוגים'},...KIND_ORDER.filter(k=>(kindCounts[k] ?? 0)>0).map(k=>({value:k,label:KIND_LABEL[k]}))]} onSelect={v=>setFilter(v as Filter)}/>
          <Dropdown flex={1.25} title="מיון משימות" value={newest?'newest':'priority'} options={[{value:'priority',label:'דחיפות ועדכניות'},{value:'newest',label:'עדכניות'}]} onSelect={v=>setNewest(v==='newest')}/>
        </View>
        {tab==='claude'?<Text style={{ ...font.small,color:colors.primary,textAlign: RTL_LABEL_ALIGN,paddingBottom:10}}>בוצע ע״י רובנס · ממתין לאישור שלך</Text>:null}
      </View>

      {failedStreams.length > 0 ? (
        <Pressable onPress={() => void reload(true)} accessibilityRole="button" style={{ padding: 14 }}>
          <Text style={{ direction: 'rtl' as const, color: colors.amber, textAlign: RTL_LABEL_ALIGN }}>המידע חלקי — לא עודכנו: {failedStreams.map(stream => STREAM_LABEL[stream]).join('، ')}. נתונים קודמים נשמרו אם היו. לחצו לניסיון חוזר.</Text>
        </Pressable>
      ) : null}
      {loading && items.length === 0 ? (
        <View style={st.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={st.body}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => reload(true)}
              tintColor={colors.primary}
            />
          }
        >
          {/* The "waiting for your reply" strip used to be pinned here, above
              the list. Those conversations are now rows IN the list with a
              צ׳אט tag — so they can be filtered, counted and worked through
              like everything else, instead of being a separate thing that
              vanished the moment you touched a filter. */}

          {visible.length === 0 ? (
            <Empty text={failedStreams.length ? 'אין פריטים להצגה מהמקורות שנטענו. הספירה אינה מלאה.' : search.trim() || filter !== 'all' ? 'אין פריטים התואמים לחיפוש ולסינון' : emptyText} />
          ) : (
            groups.map((g) => (
              <View key={g.key} style={st.group}>
                <View style={st.groupHead}>
                  <Text style={st.groupTitle}>{g.title}</Text>
                  <Text style={[st.groupCount,{backgroundColor:colors.surfaceAlt,borderRadius:8,paddingHorizontal:8,paddingVertical:3}]}>{g.items.length}</Text>
                </View>
                {g.items.slice(0,rowLimit).map((item) => (
                  <WorkRow
                    key={item.key}
                    item={item}
                    onZoom={lightbox.open}
                    onPromote={item.stream==='idea' ? async (status)=>{try{if(!await setIdeaStatus(item.id,status))throw Error();invalidateStream('idea');await reload(true);}catch (caughtError79cf765b58){
    observeCaughtError(caughtError79cf765b58, {"source":"pulse/src/screens/TasksScreen.tsx","handler":"TasksScreen","site":"TasksScreen:79cf765b58"});Alert.alert('השינוי לא נשמר','הרעיון נשאר במצבו הקודם.');}} : undefined}
                    onAccept={() => accept(item)}
                    onReopen={() => reopen(item)}
                    onWithdraw={() => withdraw(item)}
                    onPriority={(p) => setPriority(item, p)}
                    onEdit={item.stream === 'task' ? () => setEditing(item) : undefined}
                    onDelete={item.stream === 'task' || item.stream === 'idea' ? () => destroy(item) : undefined}
                    onReply={item.reporterId ? () => setReplyTo(item) : undefined}
                  />
                ))}
                {g.items.length>rowLimit?<Pressable onPress={()=>setRowLimit(n=>n+40)} style={{padding:14}}><Text style={{ ...font.body,color:colors.primary,textAlign: RTL_LABEL_ALIGN}}>הצגת פריטים נוספים ({g.items.length-rowLimit})</Text></Pressable>:null}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <ImageLightbox {...lightbox.props} onClose={lightbox.close} />

      <TeamderChatSheet
        onStatusChanged={() => { void reload(true); }}
        visible={replyTo !== null || openThread !== null}
        userId={replyTo?.reporterId ?? openThread?.id ?? ''}
        userName={replyTo?.reporterName ?? openThread?.name ?? ''}
        onClose={() => {
          setReplyTo(null);
          setOpenThread(null);
          // Re-read so an answered conversation drops off the list; the
          // thread cache is keyed inside the chat service, so force it.
          listAwaitingReply(true)
            .then(() => reload(true))
            .catch((caughtError1f6c590798: unknown) => {
    observeCaughtError(caughtError1f6c590798, {"source":"pulse/src/screens/TasksScreen.tsx","handler":"TasksScreen","site":"TasksScreen:1f6c590798"});});
        }}
      />

      <TaskComposer
        visible={composing || editing !== null}
        task={editing}
        onClose={() => {
          setComposing(false);
          setEditing(null);
        }}
        onSaved={() => {
          setComposing(false);
          setEditing(null);
          void reload(true);
        }}
      />
    </SafeAreaView>
  );
}

// ── one row ──────────────────────────────────────────────────────────────

function WorkRow({
  item,
  onAccept,
  onReopen,
  onWithdraw,
  onPriority,
  onEdit,
  onDelete,
  onReply,
  onZoom,
  onPromote,
}: {
  item: WorkItem;
  onPromote?: (status:'spec'|'build')=>Promise<void>;
  onAccept: () => void;
  onReopen: () => void;
  onWithdraw: () => void;
  onPriority: (p: TaskPriority) => void;
  /** Only tasks are editable/deletable here — the other streams are owned by
   *  their own screens (and by Teamder), so this screen doesn't rewrite them. */
  onEdit?: () => void;
  onDelete?: () => void;
  onReply?: () => void;
  /** Open the full-screen zoomable viewer on a set of images. */
  onZoom: (images: string[], at?: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  // Images are NOT in the list payload — they are the bulk of it, so the list
  // projects them away and one document is fetched here when it is opened.
  const [shots, setShots] = useState<{ images: string[]; claudeImages: string[] } | null>(
    null,
  );
  const [shotsFailed, setShotsFailed] = useState(false);
  const [shotsRetry, setShotsRetry] = useState(0);
  const [loadingShots, setLoadingShots] = useState(false);
  const isDone = item.state === 'done';
  const byClaude = item.state === 'claude';

  // `loadingShots` must NOT be a dependency. Setting it re-ran this effect,
  // whose cleanup flipped `alive` on the request already in flight — so the
  // result was discarded — and the re-run then bailed on its own guard. The
  // spinner spun for ever and no screenshot ever appeared. Depend on the
  // document path rather than on `item`, which is a fresh object every render.
  useEffect(() => {
    if (!expanded) return;
    let alive = true;
    setLoadingShots(true); setShotsFailed(false);
    loadItemImages(item)
      .then((r) => {
        if (alive) setShots(r);
      })
      .catch((caughtError0547aacb1f: unknown) => {
    observeCaughtError(caughtError0547aacb1f, {"source":"pulse/src/screens/TasksScreen.tsx","handler":"WorkRow","site":"TasksScreen:0547aacb1f"});
        if (alive) setShotsFailed(true);
      })
      .finally(() => {
        if (alive) setLoadingShots(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, item.docPath, shotsRetry, item.claude?.at]);

  const ownShots = shots?.images ?? [];
  const proofShots = shots?.claudeImages ?? [];

  return (
    <View style={[st.row, isDone && st.rowDone, byClaude && st.rowClaude]}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={item.title}
        style={st.rowMain}
        // A conversation has no body to expand — tapping it opens the thread,
        // while the separate check button resolves it without sending.
        onPress={() => (item.stream === 'chat' ? onReply?.() : setExpanded((v) => !v))}
      >
        <View style={{width:32,height:32,borderRadius:16,backgroundColor:item.kind==='error'?colors.amber+'18':colors.primarySoft,alignItems:'center',justifyContent:'center'}}><Ionicons name={KIND_ICON[item.kind] as never} size={17} color={item.kind==='error'?colors.amber:colors.primary}/></View>

        <View style={st.rowText}>
            <View style={[st.kindPill, item.kind === 'chat' && st.kindPillChat]}>
              <Ionicons
                name={KIND_ICON[item.kind] as never}
                size={10}
                color={item.kind === 'chat' ? colors.onPrimary : colors.textSoft}
              />
              <Text style={[st.kindTxt, item.kind === 'chat' && { color: '#fff' }]}>
                {KIND_LABEL[item.kind]}
              </Text>
            </View>
          <Text style={[st.rowTitle, isDone && st.strike]} numberOfLines={expanded ? 0 : 2}>
            {item.title}
          </Text>
          <View style={st.metaRow}>
            {/* The tag. Every row carries one, so the kind of work is legible
                without reading the title. */}
            {/* The idea gate, stated on the row rather than left to memory:
                a parked idea is the owner's to characterise before anyone
                builds from it. */}
            {!item.claudeMayAct && item.stream === 'idea' ? (
              <View style={st.lockPill}>
                <Ionicons name="lock-closed" size={10} color={colors.amber} />
                <Text style={st.lockTxt}>ממתין להחלטה שלך</Text>
              </View>
            ) : null}
            {byClaude ? <Text style={st.metaClaude}>בוצע ע״י רובנס · ממתין לאישורך</Text> : null}
            {item.priority === 'high' && !isDone ? (
              <Text style={[st.meta, { color: PRIORITY_COLOR.high }]}>
                {PRIORITY_LABEL.high}
              </Text>
            ) : null}
            {item.count > 1 ? <Text style={st.meta}>{item.count} מופעים</Text> : null}
            {expanded && item.screen ? <Text style={st.meta}>{item.screen}</Text> : null}
            {item.reporterName ? <Text style={st.meta}>{item.reporterName}</Text> : null}
            {expanded && item.hint && (item.claudeMayAct || item.stream === 'chat') ? <Text style={st.meta}>{item.hint}</Text> : null}
            <Text style={st.meta}>{item.createdAt?timeAgo(item.createdAt):'מועד לא תועד'}</Text>
            {/* No image indicator here on purpose: the list does not download
                image fields any more (they were 96% of the payload), so
                whether an item has one is only known once it is opened. */}
          </View>
        </View>
        <Ionicons name="chevron-back" size={16} color={colors.textMuted}/>
      </Pressable>

      {expanded ? (
        <Modal visible animationType="slide" onRequestClose={()=>setExpanded(false)}>
        <SafeAreaView style={st.safe} edges={['top','bottom']}>
        <View style={[st.headerRow,{padding:16}]}><Pressable accessibilityRole="button" onPress={()=>setExpanded(false)} style={{minHeight:44,justifyContent:'center'}}><Text style={{...font.title,color:colors.primary}}>חזרה למשימות</Text></Pressable><Text style={font.small}>{KIND_LABEL[item.kind]}</Text></View>
        <ScrollView contentContainerStyle={[st.expand,{padding:20,gap:18}]}>
          <Text style={{ ...font.h1,textAlign: RTL_LABEL_ALIGN}}>{item.title}</Text>
          <Text style={st.meta}>{byClaude?'בוצע ע״י רובנס · ממתין לאישורך':isDone?'סגורה':'פתוחה'}</Text>
          {item.unresolved && item.state === 'open' ? <View style={{padding:12,borderRadius:12,backgroundColor:'#F59E0B18',gap:8}}><Text style={[st.notes,{color:colors.text}]}>מה כבר נבדק: {item.unresolved.reason}</Text><Text style={st.notes}>מה חסר לפתרון: {item.unresolved.nextStep}</Text></View> : null}
          {item.body ? <Text style={st.notes}>{item.body}</Text> : null}
          {loadingShots ? (
            <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-end' }} />
          ) : null}
          {shotsFailed?<Pressable accessibilityRole="button" onPress={()=>setShotsRetry(n=>n+1)}><Text style={{...st.notes,color:colors.amber}}>טעינת הצילומים נכשלה. לחצו לניסיון חוזר.</Text></Pressable>:null}
          {!loadingShots && !shotsFailed && !ownShots.length?<Text style={st.meta}>לא צורף צילום לדיווח או למשימה.</Text>:null}
          {ownShots.length > 0 ? (<View style={{gap:8}}><Text style={st.groupTitle}>הצילום שצורף לדיווח או למשימה</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.shots}>
              {ownShots.map((b64, i) => (
                <Pressable key={i} onPress={() => onZoom(ownShots, i)}>
                  <Image source={{ uri: dataUri(b64) }} style={st.shot} />
                  <View style={st.zoomBadge}>
                    <Ionicons name="expand" size={11} color="#fff" />
                  </View>
                </Pressable>
              ))}
            </ScrollView></View>
          ) : null}

          {/* Claude's handover: what changed, and the proof. This is the block
              the owner reads before accepting. */}
          {item.claude ? (
            <View style={st.claudeBox}>
              <View style={st.claudeHead}>
                <Ionicons name="sparkles" size={14} color={colors.primary} />
                <Text style={st.claudeTitle}>מה תוקן</Text>
              </View>
              <Text style={st.claudeNote}>{item.claude.note || '—'}</Text>
              {proofShots.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.shots}>
                  {/* The proof is a ~900px-wide before/after table. At
                      thumbnail size it is unreadable, which defeats the point
                      of attaching it — tap to read it. */}
                  {proofShots.map((b64, i) => (
                    <Pressable key={i} onPress={() => onZoom(proofShots, i)}>
                      <Image source={{ uri: dataUri(b64) }} style={st.shotWide} />
                      <View style={st.zoomBadge}>
                        <Ionicons name="expand" size={11} color="#fff" />
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
            </View>
          ) : null}

          {(item.stream==='error'||item.stream==='report')?<DiagnosticTimeline docPath={item.docPath}/>:null}
          {item.stream === 'task' && !isDone ? (
            <View style={st.actions}>
              {PRIORITIES.map((p) => (
                <Pressable
                  key={p}
                  onPress={() => onPriority(p)}
                  style={[st.chip, item.priority === p && st.chipOn]}
                >
                  <Text style={[st.chipTxt, item.priority === p && st.chipTxtOn]}>
                    {PRIORITY_LABEL[p]}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={st.actions}>
            {onPromote && !isDone && !byClaude ? <><Pressable style={st.chip} onPress={()=>void onPromote('spec')}><Text style={st.chipTxt}>העברה לאפיון</Text></Pressable><Pressable style={st.chip} onPress={()=>void onPromote('build')}><Text style={st.chipTxt}>מוכן לביצוע</Text></Pressable></>:null}
            {!byClaude?<Pressable disabled={savingStatus} style={st.chip} onPress={async()=>{if(savingStatus)return;setSavingStatus(true);try{await (isDone?onReopen:onAccept)();}finally{setSavingStatus(false)}}}><Text style={st.chipTxt}>{isDone?'פתיחה מחדש':'סגירת המשימה'}</Text></Pressable>:null}
            {item.reporterId ? <Pressable style={st.chip} onPress={() => {setExpanded(false); (navRef as any).navigate('Users', { screen: 'UserDetail', params: { userId: item.reporterId } });}}>
              <Text style={st.chipTxt}>כרטיס המשתמש</Text>
            </Pressable> : null}
            {item.sourceReportId ? <Pressable style={st.chip} onPress={() => {setExpanded(false); (navRef as any).navigate('DevInbox', { screen: 'ErrorDetail', params: { id: item.sourceReportId, collection: 'feedback' } });}}>
              <Text style={st.chipTxt}>משימה מקושרת — פתיחת דיווח המקור</Text>
            </Pressable> : null}
            {item.stream === 'error' || item.stream === 'report' ? <Pressable style={st.chip} onPress={() => {setExpanded(false); (navRef as any).navigate('DevInbox', { screen: 'ErrorDetail', params: { id: item.id, collection: item.stream === 'error' ? 'errors' : 'feedback' } });}}>
              <Text style={st.chipTxt}>פרטי האבחון</Text>
            </Pressable> : null}
            {byClaude ? (
              <>
                <Pressable onPress={onAccept} style={[st.chip, st.chipAccent]}>
                  <Ionicons name="checkmark" size={13} color={colors.onPrimary} />
                  <Text style={[st.chipTxt, { color: colors.onPrimary }]}>אישור וסגירה</Text>
                </Pressable>
                <Pressable onPress={onWithdraw} style={st.chip}>
                  <Text style={st.chipTxt}>לא תוקן — החזר לפתוח</Text>
                </Pressable>
              </>
            ) : null}
            {onReply ? (
              <Pressable onPress={()=>{setExpanded(false);onReply?.();}} style={[st.chip, st.chipAccent]}>
                <Ionicons name="chatbubble-ellipses-outline" size={13} color={colors.onPrimary} />
                <Text style={[st.chipTxt, { color: colors.onPrimary }]}>פתיחת שיחה</Text>
              </Pressable>
            ) : null}
            {onEdit ? (
              <Pressable onPress={()=>{setExpanded(false);onEdit?.();}} style={st.chip}>
                <Text style={st.chipTxt}>עריכה</Text>
              </Pressable>
            ) : null}
            {onDelete ? (
              <Pressable onPress={onDelete} style={st.chip}>
                <Text style={[st.chipTxt, { color: colors.red }]}>מחיקה</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView></SafeAreaView></Modal>
      ) : null}
    </View>
  );
}

// ── the compose / edit form ──────────────────────────────────────────────

/** What this form can FILE. Errors, reports and chats arrive from outside and
 *  are never typed here; the other four are the ones you author yourself. */
type ComposerKind = 'bug' | 'ui' | 'feature' | 'idea';
const COMPOSER_KINDS: ComposerKind[] = ['bug', 'ui', 'feature', 'idea'];

function TaskComposer({
  visible,
  task,
  onClose,
  onSaved,
}: {
  visible: boolean;
  /** A WorkItem when editing — always a `task`, the only editable stream. */
  task: WorkItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  // The form files against a KIND, the same word the rest of the screen uses.
  // Three of them are tasks; רעיון goes to the ideas collection instead.
  const [kind, setKind] = useState<ComposerKind>('bug');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [imgs, setImgs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // The sheet sits on the bottom edge, so on a phone with a gesture bar its
  // last row lands UNDER the system navigation. Pad by the real inset.
  const insets = useSafeAreaInsets();

  // Re-seed whenever the sheet opens, so editing shows the task's own values
  // and a fresh compose starts blank instead of inheriting the last edit.
  //
  // ⚠️ The kind must come FROM THE ITEM. It was hard-coded to 'bug' here, so
  // opening a design note or a feature and pressing save silently re-filed it
  // as a bug — the edit form quietly rewriting the thing it was editing.
  useEffect(() => {
    if (!visible) return;
    setTitle(task?.title ?? '');
    setNotes(task?.body ?? '');
    setKind(
      task && (task.kind === 'ui' || task.kind === 'feature' || task.kind === 'bug')
        ? task.kind
        : 'bug',
    );
    setPriority(task?.priority ?? 'normal');
    // Images are attach-on-create only, and the list does not carry them
    // anyway (they are fetched per row on expand), so an edit starts empty.
    setImgs([]);
  }, [visible, task]);

  const pickImages = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('אין הרשאה לגלריה');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES - imgs.length,
      quality: 0.6,
    });
    if (res.canceled) return;
    const next: string[] = [];
    for (const a of res.assets) {
      // Downscale before storing: the base64 lives on the Firestore doc, and
      // the doc limit is 1 MB.
      const m = await manipulateAsync(a.uri, [{ resize: { width: 1000 } }], {
        compress: 0.6,
        format: SaveFormat.JPEG,
        base64: true,
      });
      if (m.base64) next.push(m.base64);
    }
    setImgs((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
  };

  const save = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const now = Date.now();
      if (task) {
        // Only tasks are editable here, so the kind is always a category.
        await updateTask(
          task.id,
          { title: t, notes, category: kind as TaskCategory, priority },
          now,
        );
      } else if (kind === 'idea') {
        // An idea is not a task: it belongs in pulseIdeas, where it lands as
        // 'רעיון' — parked until you characterise it. Filing it from here
        // means the one screen can capture everything, which is the point.
        await createIdea({
          text: notes.trim() ? `${t}\n\n${notes.trim()}` : t,
          images: imgs,
          now,
        });
      } else {
        await createTask({
          title: t,
          notes,
          category: kind,
          priority,
          images: imgs,
          now,
        });
      }
      onSaved();
    } catch (caughtError996b1ff5ed) {
    observeCaughtError(caughtError996b1ff5ed, {"source":"pulse/src/screens/TasksScreen.tsx","handler":"save","site":"TasksScreen:996b1ff5ed"});
      Alert.alert('השמירה נכשלה', 'נסה שוב');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={st.modalWrap}>
        <View style={[st.modal, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={st.modalHead}>
            <Text style={font.h2}>
              {task ? 'עריכת משימה' : kind === 'idea' ? 'רעיון חדש' : 'משימה חדשה'}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textSoft} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" style={st.modalScroll}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="מה צריך לעשות?"
              placeholderTextColor={colors.textMuted}
              style={st.input}
              textAlign="right"
            />
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="פירוט (לא חובה)"
              placeholderTextColor={colors.textMuted}
              style={[st.input, st.inputMulti]}
              multiline
              textAlign="right"
            />

            <Text style={st.label}>סוג</Text>
            <View style={st.chipRow}>
              {/* Same words and icons as the tags on the list. The form used to
                  say "באגים / עיצוב וממשק / פיצ׳רים" while the rows said
                  "באג / עיצוב / פיצ׳ר" — two names for one thing, on one
                  screen. Editing offers only the three task kinds, because an
                  existing item cannot change collection. */}
              {(task ? COMPOSER_KINDS.filter((k) => k !== 'idea') : COMPOSER_KINDS).map(
                (k) => (
                  <Pressable
                    key={k}
                    onPress={() => setKind(k)}
                    style={[st.bigChip, kind === k && st.chipOn]}
                  >
                    <Ionicons
                      name={KIND_ICON[k] as never}
                      size={15}
                      color={kind === k ? colors.onPrimary : colors.textSoft}
                    />
                    <Text style={[st.chipTxt, kind === k && st.chipTxtOn]}>
                      {KIND_LABEL[k]}
                    </Text>
                  </Pressable>
                ),
              )}
            </View>

            {/* An idea has no priority — the ideas backlog ranks by its own
                status (רעיון → לאיפיון → לביצוע), so offering one here would
                collect a value nothing reads. */}
            {kind !== 'idea' ? (
              <>
            <Text style={st.label}>עדיפות</Text>
            <View style={st.chipRow}>
              {PRIORITIES.map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPriority(p)}
                  style={[st.bigChip, priority === p && st.chipOn]}
                >
                  <Text style={[st.chipTxt, priority === p && st.chipTxtOn]}>
                    {PRIORITY_LABEL[p]}
                  </Text>
                </Pressable>
              ))}
            </View>
              </>
            ) : null}

            {/* Images are attach-on-create only: editing them would mean
                re-uploading the whole array on every keystroke-level save. */}
            {!task ? (
              <>
                <Text style={st.label}>תמונות</Text>
                <View style={st.imgRow}>
                  {imgs.map((b64, i) => (
                    <Pressable
                      key={i}
                      onPress={() => setImgs((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Image source={{ uri: dataUri(b64) }} style={st.thumb} />
                    </Pressable>
                  ))}
                  {imgs.length < MAX_IMAGES ? (
                    <Pressable style={st.addImg} onPress={pickImages}>
                      <Ionicons name="image-outline" size={20} color={colors.textSoft} />
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : null}

          </ScrollView>

          {/* Outside the ScrollView on purpose: the primary action must never
              depend on the user scrolling to reach it. */}
          <Pressable
            onPress={save}
            disabled={!title.trim() || busy}
            style={({ pressed }) => [
              st.save,
              (!title.trim() || busy) && { opacity: 0.5 },
              pressed && { opacity: 0.85 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={st.saveTxt}>
              {task ? 'שמור' : kind === 'idea' ? 'הוסף רעיון' : 'הוסף משימה'}
            </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 18, paddingTop: 12 },
  headerRow: {
    flexDirection: 'row', direction: 'rtl' as const,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addBtn: {
    flexDirection: 'row', direction: 'rtl' as const,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  addBtnTxt: { ...font.small, color: colors.onPrimary, fontWeight: '800' },
  tabs: {flexDirection:'row',direction:'rtl',borderBottomWidth:1,borderBottomColor:colors.border,marginTop:10,marginBottom:8},
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14, minHeight:48, borderBottomWidth:2, borderBottomColor:'transparent' },
  tabOn: { borderBottomColor: colors.primary },
  tabTxt: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  tabTxtOn: { color: colors.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 18, paddingTop: 4, paddingBottom: 28, gap: 14 },

  waitBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    padding: 10,
    gap: 6,
  },
  waitTitle: { 
    ...font.small,
    color: colors.primary,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  waitRow: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 8 },
  waitName: {  ...font.small, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  waitText: {  ...font.small, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },

  group: { gap: 6 },
  groupHead: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 6, marginBottom: 2 },
  groupTitle: { ...font.body, fontWeight: '800', color: colors.text },
  groupCount: { ...font.small, color: colors.textMuted },

  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  rowDone: { opacity: 0.6 },
  rowMain: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'flex-start', gap: 12, padding: 16 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkOn: { backgroundColor: colors.green, borderColor: colors.green },
  rowText: { flex: 1, gap: 5 },
  rowTitle: { 
    ...font.title,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  strike: { textDecorationLine: 'line-through', color: colors.textMuted },
  metaRow: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  meta: {  ...font.small, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  metaDoing: { ...font.small, color: colors.primary, fontWeight: '800' },

  expand: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 12,
    gap: 8,
    backgroundColor: colors.bg,
  },
  notes: { 
    ...font.small,
    color: colors.textSoft,
    textAlign: RTL_LABEL_ALIGN,
  },
  shots: { flexGrow: 0 },
  shot: { width: 240, height: 320, resizeMode: 'contain', borderRadius: radius.sm, marginLeft: 8 },
  // Claude's proof is a wide table, not a phone screenshot — a square crop of
  // it shows one corner and nothing legible. Wider and letterboxed so the
  // shape of the table is recognisable before you open it.
  shotWide: {
    width: 190,
    height: 100,
    borderRadius: radius.sm,
    marginLeft: 8,
    resizeMode: 'contain',
    backgroundColor: colors.bg,
  },
  zoomBadge: {
    position: 'absolute',
    bottom: 5,
    left: 13,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  actions: { flexDirection: 'row', direction: 'rtl' as const, gap: 6, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  bigChip: {
    flexDirection: 'row', direction: 'rtl' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipAccent: {
    flexDirection: 'row', direction: 'rtl' as const,
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipTxt: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  chipTxtOn: { color: colors.onPrimary },

  kindPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row', direction: 'rtl' as const,
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // A waiting conversation is the only kind with a person on the other end of
  // it, so its tag is the one that carries colour.
  kindPillChat: { backgroundColor: colors.primary, borderColor: colors.primary },
  kindTxt: { ...font.small, color: colors.textSoft, fontWeight: '800', fontSize: 10 },
  checkChat: { borderColor: colors.primary },

  filterRow: { flexDirection: 'row', direction: 'rtl' as const, gap: 6, paddingBottom: 8 },
  filterChip: {
    flexDirection: 'row', direction: 'rtl' as const,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },

  // An item Claude finished reads as pending review, not as closed: it keeps
  // full contrast and gains an accent edge, unlike the faded `rowDone`.
  rowClaude: { borderColor: colors.primary },
  checkClaude: { borderColor: colors.primary },
  metaClaude: { ...font.small, color: colors.primary, fontWeight: '800' },
  lockPill: {
    flexDirection: 'row', direction: 'rtl' as const,
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lockTxt: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  claudeBox: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    padding: 10,
    gap: 6,
    backgroundColor: colors.surface,
  },
  claudeHead: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 5 },
  claudeTitle: { 
    ...font.small,
    color: colors.primary,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  claudeNote: { 
    ...font.small,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },

  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 16,
    maxHeight: '90%',
  },
  modalHead: {
    flexDirection: 'row', direction: 'rtl' as const,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.text,
    marginBottom: 10,
  },
  modalScroll: { flexShrink: 1 },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  label: { 
    ...font.small,
    color: colors.textSoft,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: 6,
  },
  chipRow: { flexDirection: 'row', direction: 'rtl' as const, gap: 6, marginBottom: 12 },
  imgRow: { flexDirection: 'row', direction: 'rtl' as const, gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  thumb: { width: 64, height: 64, borderRadius: radius.sm },
  addImg: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  save: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  saveTxt: { ...font.body, color: colors.onPrimary, fontWeight: '800' },
});
