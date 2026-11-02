import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { findNodeHandle, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from 'react-native';
import { activateListOwner, readListOffset, readListValue, writeListOffset, writeListValue } from '@/utils/listMemory';

export function useRememberedValue<T>(ownerId: string | undefined, scope: string, field: string, initial: T) {
  const owner = ownerId ?? null;
  activateListOwner(owner);
  const key = JSON.stringify([owner, scope, field]);
  const active = useRef(key); active.current = key;
  const [local, setLocal] = useState(() => ({ key, value: readListValue(owner, scope, field, initial) }));
  const value = local.key === key ? local.value : readListValue(owner, scope, field, initial);
  const latest = useRef(value); latest.current = value;
  const update = useCallback((next: SetStateAction<T>) => {
    if (active.current !== key) return;
    const result = typeof next === 'function' ? (next as (previous: T) => T)(latest.current) : next;
    latest.current = result; writeListValue(owner, scope, field, result); setLocal({ key, value: result });
  }, [owner, scope, field, key]);
  return [value, update] as const;
}

/** Restore once after real content is laid out. A user drag always wins. */
export function useRememberedScroll(ownerId: string | undefined, scope: string, ready = true, itemCount?: number) {
  const owner = ownerId ?? null;
  activateListOwner(owner);
  const key = JSON.stringify([owner, scope]);
  const ref = useRef<any>(null);
  const virtualized = itemCount !== undefined;
  const record = useRef({ key, ready, itemCount, endVisible: ready && itemCount === 0, awaitingOffset: null as number | null, lastOffset: null as number | null,
    layoutReady: false, contentReady: false, target: readListOffset(owner, scope), restored: false, height: 0, viewport: 0 });
  // React Native may keep the same scroll surface when a filter changes, so
  // onLayout need not fire again. Reuse its viewport; content size is refreshed
  // by the surface and is only consulted after the current data is ready.
  if (record.current.key !== key) record.current = { key, ready, itemCount, endVisible: ready && itemCount === 0, awaitingOffset: null, lastOffset: null,
    layoutReady: false, contentReady: false, target: readListOffset(owner, scope), restored: false, height: record.current.height, viewport: record.current.viewport };
  if (record.current.ready !== ready) { record.current.ready = ready; record.current.contentReady = false; record.current.layoutReady = false; }
  if (record.current.itemCount !== itemCount) { record.current.itemCount = itemCount; record.current.endVisible = ready && itemCount === 0; }
  if (ready && itemCount === 0) record.current.endVisible = true;
  const [position, setPosition] = useState({ key, nearStart: record.current.target <= 80 });
  const nearStart = position.key === key ? position.nearStart : record.current.target <= 80;
  const restore = useCallback((afterLayout = false) => {
    const state = record.current;
    if (state.key !== key || state.restored || !ready || !state.ready || !ref.current || !state.viewport || state.target > 0 && !state.layoutReady || !state.contentReady && !afterLayout) return;
    const offset = Math.min(state.target, Math.max(0, state.height - state.viewport));
    if (virtualized && offset < state.target && !state.endVisible) {
      // A partial render is not the end of a virtualized list. Keep the target
      // until it fits, or the last actual item is visible. No guessed timeout.
      state.awaitingOffset = null;
      ref.current.scrollToOffset?.({ offset: state.target, animated: false });
      return;
    }
    state.awaitingOffset = virtualized && offset > 0 ? offset : null;
    const alreadyThere = state.lastOffset !== null && Math.abs(state.lastOffset - offset) <= 1;
    state.restored = state.awaitingOffset === null || alreadyThere;
    if (ref.current.scrollToOffset) ref.current.scrollToOffset({ offset, animated: false });
    else ref.current.scrollTo?.({ y: offset, animated: false });
    if (!state.restored) return; // The native scroll event confirms the actual offset.
    const confirmed = virtualized && alreadyThere ? state.lastOffset! : offset;
    writeListOffset(owner, scope, confirmed); setPosition({ key, nearStart: confirmed <= 80 });
  }, [key, owner, scope, ready, virtualized]);
  useEffect(() => {
    restore();
    if (!ready || record.current.restored) return;
    // Equal-size content need not emit another native size event. Wait until
    // the new commit has crossed two frames before using unchanged geometry.
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: FrameRequestCallback) => setTimeout(() => fn(Date.now()), 16) as unknown as number;
    const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
    let second: number | undefined;
    const first = frame(() => { second = frame(() => { if (record.current.key === key && record.current.ready) { record.current.layoutReady = true; restore(true); } }); });
    return () => { cancel(first); if (second !== undefined) cancel(second); };
  }, [restore, ready]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const state = record.current;
    if (state.key !== key) return;
    const offset = Math.max(0, event.nativeEvent.contentOffset.y);
    state.lastOffset = offset;
    if (!state.restored && state.target > 0) {
      if (state.awaitingOffset === null || Math.abs(offset - state.awaitingOffset) > 1) return;
      state.restored = true; state.awaitingOffset = null;
    }
    writeListOffset(owner, scope, offset);
    setPosition(previous => previous.key === key && previous.nearStart === (offset <= 80) ? previous : { key, nearStart: offset <= 80 });
  }, [key, owner, scope]);
  const onScrollBeginDrag = useCallback(() => { if (record.current.key === key) { record.current.restored = true; record.current.awaitingOffset = null; } }, [key]);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    if (record.current.key !== key) return;
    // VirtualizedList also forwards ListEmptyComponent's layout through this
    // prop. Its small content height is not the viewport's height.
    const target = (event.nativeEvent as typeof event.nativeEvent & { target?: unknown }).target;
    const nativeScroll = ref.current?.getNativeScrollRef?.();
    const scrollTag = nativeScroll ? findNodeHandle(nativeScroll) : null;
    if (virtualized && scrollTag !== null && typeof target === 'number' && target !== scrollTag) return;
    record.current.viewport = event.nativeEvent.layout.height; restore();
  }, [key, virtualized, restore]);
  const onContentSizeChange = useCallback((_width: number, height: number) => {
    if (record.current.key !== key || record.current.ready !== ready) return;
    record.current.height = height; record.current.contentReady = ready; restore();
  }, [key, ready, restore]);
  const toStart = useCallback((animated = true) => {
    if (record.current.key !== key) return;
    record.current.restored = true; record.current.awaitingOffset = null; record.current.target = 0; writeListOffset(owner, scope, 0);
    setPosition({ key, nearStart: true });
    if (ref.current?.scrollToOffset) ref.current.scrollToOffset({ offset: 0, animated });
    else ref.current?.scrollTo?.({ y: 0, animated });
  }, [key, owner, scope]);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (record.current.key !== key || !ready || !itemCount) return;
    if (viewableItems.some(item => item.index === itemCount - 1 && item.isViewable)) {
      record.current.endVisible = true; restore();
    }
  }, [key, ready, itemCount, restore]);
  return { ref, nearStart, toStart, onScroll, onScrollBeginDrag, onLayout, onContentSizeChange, onViewableItemsChanged };
}
