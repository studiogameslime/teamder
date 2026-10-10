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
//   בוצע ע״י קלוד — Claude finished it, wrote down what changed and attached
//                   proof. Still open everywhere else; it is waiting for the
//                   owner to read it and accept. THIS is the review queue.
//   בוצע          — the owner accepted it.
//
// Speed still matters: this replaced a dashboard that opened on four heavy
// network calls. Tasks paint from an on-disk snapshot first, and the remaining
// streams share the same caches the old screens used, so nothing here costs a
// read that wasn't already being paid.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { colors, font, radius } from '../theme';
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
import { createIdea } from '../services/ideasService';
import {
  KIND_ICON,
  KIND_LABEL,
  KIND_ORDER,
  closeItem,
  groupByKind,
  listWork,
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

type Tab = 'open' | 'claude' | 'done';
const TAB_LABEL: Record<Tab, string> = {
  open: 'פתוחות',
  claude: 'בוצע ע״י קלוד',
  // "סגורות", not "בוצע" — the tab holds anything that left the list, and it
  // gets emptied periodically rather than kept as a permanent archive.
  done: 'סגורות',
};

/** Tag filter — `all` plus one chip per kind. */
type Filter = 'all' | WorkKind;

export function TasksScreen() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('open');
  const [filter, setFilter] = useState<Filter>('all');
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
        const fresh = await listWork();
        if (alive) setItems(fresh);
      } catch {
        /* keep whatever the snapshot gave us */
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
      setItems(await listWork(force));
    } catch {
      /* offline — the list on screen stays */
    } finally {
      setRefreshing(false);
    }
  }, []);

  const byState = useMemo(
    () => ({
      open: items.filter((i) => i.state === 'open'),
      claude: items.filter((i) => i.state === 'claude'),
      done: items.filter((i) => i.state === 'done'),
    }),
    [items],
  );

  const visible = useMemo(() => {
    const list = byState[tab];
    return filter === 'all' ? list : list.filter((i) => i.kind === filter);
  }, [byState, tab, filter]);

  const groups = useMemo(() => groupByKind(visible), [visible]);

  /** Counts per KIND inside the CURRENT tab — drives the filter chips. */
  const kindCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const i of byState[tab]) out[i.kind] = (out[i.kind] ?? 0) + 1;
    return out;
  }, [byState, tab]);

  /** Accept an item: close it in whatever word its own collection speaks. */
  const accept = async (item: WorkItem) => {
    setItems((prev) =>
      prev.map((i) => (i.key === item.key ? { ...i, state: 'done' } : i)),
    );
    await closeItem(item).catch(() => {});
  };

  const reopen = async (item: WorkItem) => {
    setItems((prev) =>
      prev.map((i) => (i.key === item.key ? { ...i, state: i.claude ? 'claude' : 'open' } : i)),
    );
    await reopenItem(item).catch(() => {});
  };

  /** Withdraw Claude's handover — the item goes back to plain open. */
  const withdraw = async (item: WorkItem) => {
    setItems((prev) =>
      prev.map((i) => (i.key === item.key ? { ...i, state: 'open', claude: null } : i)),
    );
    await clearDoneByClaude(item.docPath).catch(() => {});
    invalidateStream(item.stream);
  };

  const setPriority = async (item: WorkItem, p: TaskPriority) => {
    if (item.stream !== 'task') return;
    setItems((prev) => prev.map((i) => (i.key === item.key ? { ...i, priority: p } : i)));
    await updateTask(item.id, { priority: p }, Date.now()).catch(() => {});
  };

  const destroy = (item: WorkItem) => {
    Alert.alert('למחוק את המשימה?', item.title, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          setItems((prev) => prev.filter((i) => i.key !== item.key));
          await removeTask(item.id).catch(() => {});
        },
      },
    ]);
  };

  const emptyText =
    tab === 'open'
      ? 'אין שום דבר פתוח 🎉'
      : tab === 'claude'
        ? 'קלוד עוד לא סיים כלום שממתין לאישור'
        : 'עוד לא אושר כלום';

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <View style={st.headerRow}>
          <Text style={font.h1}>משימות</Text>
          <Pressable
            onPress={() => setComposing(true)}
            style={({ pressed }) => [st.addBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={st.addBtnTxt}>משימה</Text>
          </Pressable>
        </View>

        <View style={st.tabs}>
          {(['open', 'claude', 'done'] as Tab[]).map((k) => {
            const on = tab === k;
            const n = byState[k].length;
            return (
              <Pressable key={k} onPress={() => setTab(k)} style={[st.tab, on && st.tabOn]}>
                <Text style={[st.tabTxt, on && st.tabTxtOn]} numberOfLines={1}>
                  {TAB_LABEL[k]} {n > 0 ? `(${n})` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Tag filter. `all` is the default and the point — everything sits
            together — but a chip per tag makes it possible to work through one
            kind at a time. A chip only appears when the current tab has
            something of that kind, so the row never fills with zeroes. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={st.filterRow}
        >
          {(['all', ...KIND_ORDER] as Filter[]).map((f) => {
            const on = filter === f;
            const n = f === 'all' ? byState[tab].length : (kindCounts[f] ?? 0);
            if (f !== 'all' && n === 0) return null;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[st.filterChip, on && st.chipOn]}
              >
                {f !== 'all' ? (
                  <Ionicons
                    name={KIND_ICON[f] as never}
                    size={12}
                    color={on ? '#fff' : colors.textSoft}
                  />
                ) : null}
                <Text style={[st.chipTxt, on && st.chipTxtOn]}>
                  {f === 'all' ? 'הכל' : KIND_LABEL[f]} {n}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

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
            <Empty text={emptyText} />
          ) : (
            groups.map((g) => (
              <View key={g.kind} style={st.group}>
                <View style={st.groupHead}>
                  <Ionicons
                    name={KIND_ICON[g.kind] as never}
                    size={16}
                    color={colors.primary}
                  />
                  <Text style={st.groupTitle}>{KIND_LABEL[g.kind]}</Text>
                  <Text style={st.groupCount}>{g.items.length}</Text>
                </View>
                {g.items.map((item) => (
                  <WorkRow
                    key={item.key}
                    item={item}
                    onZoom={lightbox.open}
                    onAccept={() => accept(item)}
                    onReopen={() => reopen(item)}
                    onWithdraw={() => withdraw(item)}
                    onPriority={(p) => setPriority(item, p)}
                    onEdit={item.stream === 'task' ? () => setEditing(item) : undefined}
                    onDelete={item.stream === 'task' ? () => destroy(item) : undefined}
                    onReply={item.reporterId ? () => setReplyTo(item) : undefined}
                  />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <ImageLightbox {...lightbox.props} onClose={lightbox.close} />

      <TeamderChatSheet
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
            .catch(() => {});
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
}: {
  item: WorkItem;
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
  // Images are NOT in the list payload — they are the bulk of it, so the list
  // projects them away and one document is fetched here when it is opened.
  const [shots, setShots] = useState<{ images: string[]; claudeImages: string[] } | null>(
    null,
  );
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
    setLoadingShots(true);
    loadItemImages(item)
      .then((r) => {
        if (alive) setShots(r);
      })
      .catch(() => {
        if (alive) setShots({ images: [], claudeImages: [] });
      })
      .finally(() => {
        if (alive) setLoadingShots(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, item.docPath]);

  const ownShots = shots?.images ?? [];
  const proofShots = shots?.claudeImages ?? [];

  return (
    <View style={[st.row, isDone && st.rowDone, byClaude && st.rowClaude]}>
      <Pressable
        style={st.rowMain}
        // A conversation has no body to expand — tapping it opens the thread,
        // which is the only thing you can do about it.
        onPress={() => (item.stream === 'chat' ? onReply?.() : setExpanded((v) => !v))}
      >
        <Pressable
          hitSlop={10}
          onPress={item.stream === 'chat' ? onReply : isDone ? onReopen : onAccept}
          style={[
            st.check,
            isDone && st.checkOn,
            byClaude && st.checkClaude,
            item.stream === 'chat' && st.checkChat,
          ]}
        >
          {item.stream === 'chat' ? (
            <Ionicons name="arrow-undo" size={13} color={colors.primary} />
          ) : null}
          {isDone ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
          {byClaude ? <Ionicons name="sparkles" size={12} color={colors.primary} /> : null}
        </Pressable>

        <View style={st.rowText}>
          <Text style={[st.rowTitle, isDone && st.strike]} numberOfLines={expanded ? 0 : 2}>
            {item.title}
          </Text>
          <View style={st.metaRow}>
            {/* The tag. Every row carries one, so the kind of work is legible
                without reading the title. */}
            <View style={[st.kindPill, item.kind === 'chat' && st.kindPillChat]}>
              <Ionicons
                name={KIND_ICON[item.kind] as never}
                size={10}
                color={item.kind === 'chat' ? '#fff' : colors.textSoft}
              />
              <Text style={[st.kindTxt, item.kind === 'chat' && { color: '#fff' }]}>
                {KIND_LABEL[item.kind]}
              </Text>
            </View>
            {/* The idea gate, stated on the row rather than left to memory:
                a parked idea is the owner's to characterise before anyone
                builds from it. */}
            {!item.claudeMayAct ? (
              <View style={st.lockPill}>
                <Ionicons name="lock-closed" size={10} color={colors.amber} />
                <Text style={st.lockTxt}>לא לקלוד — לאפיון מצידכם</Text>
              </View>
            ) : null}
            {byClaude ? <Text style={st.metaClaude}>בוצע ע״י קלוד · ממתין לאישורך</Text> : null}
            {item.priority === 'high' && !isDone ? (
              <Text style={[st.meta, { color: PRIORITY_COLOR.high }]}>
                {PRIORITY_LABEL.high}
              </Text>
            ) : null}
            {item.count > 1 ? <Text style={st.meta}>×{item.count}</Text> : null}
            {item.screen ? <Text style={st.meta}>{item.screen}</Text> : null}
            {item.reporterName ? <Text style={st.meta}>{item.reporterName}</Text> : null}
            {item.hint && item.claudeMayAct ? <Text style={st.meta}>{item.hint}</Text> : null}
            {/* No image indicator here on purpose: the list does not download
                image fields any more (they were 96% of the payload), so
                whether an item has one is only known once it is opened. */}
          </View>
        </View>
      </Pressable>

      {expanded ? (
        <View style={st.expand}>
          {(item.stream==='error'||item.stream==='report')?<DiagnosticTimeline docPath={item.docPath}/>:null}
          {item.body ? <Text style={st.notes}>{item.body}</Text> : null}
          {loadingShots ? (
            <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-end' }} />
          ) : null}
          {ownShots.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.shots}>
              {ownShots.map((b64, i) => (
                <Pressable key={i} onPress={() => onZoom(ownShots, i)}>
                  <Image source={{ uri: dataUri(b64) }} style={st.shot} />
                  <View style={st.zoomBadge}>
                    <Ionicons name="expand" size={11} color="#fff" />
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {/* Claude's handover: what changed, and the proof. This is the block
              the owner reads before accepting. */}
          {item.claude ? (
            <View style={st.claudeBox}>
              <View style={st.claudeHead}>
                <Ionicons name="sparkles" size={14} color={colors.primary} />
                <Text style={st.claudeTitle}>מה קלוד עשה</Text>
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
            {byClaude ? (
              <>
                <Pressable onPress={onAccept} style={[st.chip, st.chipAccent]}>
                  <Ionicons name="checkmark" size={13} color="#fff" />
                  <Text style={[st.chipTxt, { color: '#fff' }]}>אישור וסגירה</Text>
                </Pressable>
                <Pressable onPress={onWithdraw} style={st.chip}>
                  <Text style={st.chipTxt}>לא תוקן — החזר לפתוח</Text>
                </Pressable>
              </>
            ) : null}
            {onReply ? (
              <Pressable onPress={onReply} style={[st.chip, st.chipAccent]}>
                <Ionicons name="chatbubble-ellipses-outline" size={13} color="#fff" />
                <Text style={[st.chipTxt, { color: '#fff' }]}>השב למדווח</Text>
              </Pressable>
            ) : null}
            {onEdit ? (
              <Pressable onPress={onEdit} style={st.chip}>
                <Text style={st.chipTxt}>עריכה</Text>
              </Pressable>
            ) : null}
            {onDelete ? (
              <Pressable onPress={onDelete} style={st.chip}>
                <Text style={[st.chipTxt, { color: colors.red }]}>מחיקה</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
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
    } catch {
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
                      color={kind === k ? '#fff' : colors.textSoft}
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
              <ActivityIndicator color="#fff" />
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
  header: { paddingHorizontal: 14, paddingTop: 8 },
  headerRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  addBtnTxt: { ...font.small, color: '#fff', fontWeight: '800' },
  tabs: {
    flexDirection: 'row-reverse',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 4,
    marginTop: 10,
    marginBottom: 6,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm },
  tabOn: { backgroundColor: colors.primary },
  tabTxt: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  tabTxtOn: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 14, paddingTop: 4, paddingBottom: 28, gap: 14 },

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
    textAlign: 'right',
  },
  waitRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  waitName: { ...font.small, color: colors.text, fontWeight: '700', textAlign: 'right' },
  waitText: { ...font.small, color: colors.textMuted, textAlign: 'right' },

  group: { gap: 6 },
  groupHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginBottom: 2 },
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
  rowMain: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10, padding: 12 },
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
  rowText: { flex: 1, gap: 3 },
  rowTitle: {
    ...font.body,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  strike: { textDecorationLine: 'line-through', color: colors.textMuted },
  metaRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  meta: { ...font.small, color: colors.textMuted, textAlign: 'right' },
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
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  shots: { flexGrow: 0 },
  shot: { width: 92, height: 92, borderRadius: radius.sm, marginLeft: 8 },
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
  actions: { flexDirection: 'row-reverse', gap: 6, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  bigChip: {
    flexDirection: 'row-reverse',
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
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipTxt: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  chipTxtOn: { color: '#fff' },

  kindPill: {
    flexDirection: 'row-reverse',
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

  filterRow: { flexDirection: 'row-reverse', gap: 6, paddingBottom: 8 },
  filterChip: {
    flexDirection: 'row-reverse',
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
    flexDirection: 'row-reverse',
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
  claudeHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  claudeTitle: {
    ...font.small,
    color: colors.primary,
    fontWeight: '800',
    textAlign: 'right',
  },
  claudeNote: {
    ...font.small,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
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
    flexDirection: 'row-reverse',
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
    writingDirection: 'rtl',
  },
  modalScroll: { flexShrink: 1 },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  label: {
    ...font.small,
    color: colors.textSoft,
    fontWeight: '800',
    textAlign: 'right',
    marginBottom: 6,
  },
  chipRow: { flexDirection: 'row-reverse', gap: 6, marginBottom: 12 },
  imgRow: { flexDirection: 'row-reverse', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
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
  saveTxt: { ...font.body, color: '#fff', fontWeight: '800' },
});
