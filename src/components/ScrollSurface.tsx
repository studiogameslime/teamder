import React, { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { recordDiagnostic } from '@/services/diagnosticJournal';

const ScrollActivity = createContext<boolean | null>(null);

/** Native scrolling remains native: no per-frame JS listener or offset state. */
export const ScrollSurface = forwardRef<ScrollView, ScrollViewProps>(function ScrollSurface({
  children, onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, onStaleMomentumRecovered, ...props
}, ref) {
  const [moving, setMoving] = useState(false);
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearEnd = useCallback(() => {
    if (endTimer.current !== null) clearTimeout(endTimer.current);
    endTimer.current = null;
  }, []);
  const begin = useCallback(() => { clearEnd(); setMoving(true); }, [clearEnd]);
  const end = useCallback(() => { clearEnd(); setMoving(false); }, [clearEnd]);
  useEffect(() => clearEnd, [clearEnd]);
  return <ScrollActivity.Provider value={moving}>
    <ScrollView {...props} ref={ref}
      recoverStaleMomentumAfterMs={250}
      scrollEventThrottle={Math.min(props.scrollEventThrottle || 16, 64)}
      onStaleMomentumRecovered={()=>{recordDiagnostic('scroll','stale_momentum_recovered');end();onStaleMomentumRecovered?.();}}
      onScrollBeginDrag={event => { recordDiagnostic('scroll','drag_start',{offsetX:event.nativeEvent?.contentOffset?.x,offsetY:event.nativeEvent?.contentOffset?.y});begin(); onScrollBeginDrag?.(event); }}
      onScrollEndDrag={event => {
        recordDiagnostic('scroll','drag_end',{offsetX:event.nativeEvent?.contentOffset?.x,offsetY:event.nativeEvent?.contentOffset?.y});
        clearEnd();
        // Momentum starts after drag-end. Avoid restarting counters in that gap.
        endTimer.current = setTimeout(end, 120);
        onScrollEndDrag?.(event);
      }}
      onMomentumScrollBegin={event => { recordDiagnostic('scroll','momentum_start',{offsetX:event.nativeEvent?.contentOffset?.x,offsetY:event.nativeEvent?.contentOffset?.y});begin(); onMomentumScrollBegin?.(event); }}
      onMomentumScrollEnd={event => { recordDiagnostic('scroll','momentum_end',{offsetX:event.nativeEvent?.contentOffset?.x,offsetY:event.nativeEvent?.contentOffset?.y});end(); onMomentumScrollEnd?.(event); }}
    >{children}</ScrollView>
  </ScrollActivity.Provider>;
});

export const useScrollActivity = () => useContext(ScrollActivity) === true;
