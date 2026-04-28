// Reusable date / time form fields. Each renders a labelled tappable
// input that opens a modal picker — no horizontal chip rows.
//
// Storage formats (unchanged from previous implementation):
//   • AppTimeField        → "HH:mm" string
//   • AppDateField        → ms epoch number
//   • AppDateTimeField    → ms epoch number
//
// Built on RN primitives. No native datetime dep is installed in this
// project; we ship a custom modal calendar (month grid) and a wheel-
// style time picker (hour + minute scrollable columns).

import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

const HEBREW_DAY_HEADERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const HEBREW_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

const ROW_H = 44;
const VISIBLE_ROWS = 5;
const MINUTE_STEP = 15;

const pad2 = (n: number) => String(n).padStart(2, '0');

// ─── AppTimeField ──────────────────────────────────────────────────────

interface AppTimeFieldProps {
  label: string;
  /** Empty string when nothing selected. */
  value: string;
  onChange: (hhmm: string) => void;
  /** Optional clear-able pattern — when true, picker shows a "clear" action. */
  allowClear?: boolean;
  placeholder?: string;
  style?: ViewStyle;
}

export function AppTimeField({
  label,
  value,
  onChange,
  allowClear = true,
  placeholder,
  style,
}: AppTimeFieldProps) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.input,
          styles.inputRow,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Ionicons
          name="time-outline"
          size={18}
          color={colors.textMuted}
        />
        <Text
          style={[
            styles.value,
            !value && { color: colors.textMuted },
          ]}
        >
          {value || placeholder || he.dtfPickTime}
        </Text>
      </Pressable>
      <TimePickerModal
        visible={open}
        initial={value}
        onClose={() => setOpen(false)}
        onConfirm={(hhmm) => {
          onChange(hhmm);
          setOpen(false);
        }}
        onClear={
          allowClear
            ? () => {
                onChange('');
                setOpen(false);
              }
            : undefined
        }
      />
    </View>
  );
}

// ─── AppDateField ──────────────────────────────────────────────────────

interface AppDateFieldProps {
  label: string;
  /** ms epoch. */
  value: number;
  onChange: (ts: number) => void;
  style?: ViewStyle;
}

export function AppDateField({
  label,
  value,
  onChange,
  style,
}: AppDateFieldProps) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.input,
          styles.inputRow,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Ionicons
          name="calendar-outline"
          size={18}
          color={colors.textMuted}
        />
        <Text style={styles.value}>{formatDate(value)}</Text>
      </Pressable>
      <DatePickerModal
        visible={open}
        initial={value}
        onClose={() => setOpen(false)}
        onConfirm={(ts) => {
          onChange(ts);
          setOpen(false);
        }}
      />
    </View>
  );
}

// ─── AppDateTimeField ──────────────────────────────────────────────────

interface AppDateTimeFieldProps {
  label: string;
  value: number;
  onChange: (ts: number) => void;
  style?: ViewStyle;
}

/**
 * Combined date + time editor — opens a single modal that shows the
 * calendar with a small time strip below it. The result is one
 * timestamp (date taken from the calendar, time from the strip).
 */
export function AppDateTimeField({
  label,
  value,
  onChange,
  style,
}: AppDateTimeFieldProps) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.input,
          styles.inputRow,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Ionicons
          name="calendar-outline"
          size={18}
          color={colors.textMuted}
        />
        <Text style={styles.value}>{formatDateTime(value)}</Text>
      </Pressable>
      <DateTimePickerModal
        visible={open}
        initial={value}
        onClose={() => setOpen(false)}
        onConfirm={(ts) => {
          onChange(ts);
          setOpen(false);
        }}
      />
    </View>
  );
}

// ─── Modals ────────────────────────────────────────────────────────────

function TimePickerModal({
  visible,
  initial,
  onClose,
  onConfirm,
  onClear,
}: {
  visible: boolean;
  initial: string;
  onClose: () => void;
  onConfirm: (hhmm: string) => void;
  onClear?: () => void;
}) {
  const [{ h, m }, setSel] = useState(() => parseTime(initial));
  // Reset internal state when re-opened with a different initial.
  React.useEffect(() => {
    if (visible) setSel(parseTime(initial));
  }, [visible, initial]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={styles.modalTitle}>{he.dtfPickTime}</Text>
          <View style={styles.wheelRow}>
            <WheelColumn
              values={Array.from({ length: 24 }, (_, i) => pad2(i))}
              selected={pad2(h)}
              onSelect={(v) => setSel({ h: parseInt(v, 10), m })}
            />
            <Text style={styles.wheelSep}>:</Text>
            <WheelColumn
              values={Array.from(
                { length: 60 / MINUTE_STEP },
                (_, i) => pad2(i * MINUTE_STEP),
              )}
              selected={snapMinute(m)}
              onSelect={(v) => setSel({ h, m: parseInt(v, 10) })}
            />
          </View>
          <View style={styles.modalFooter}>
            {onClear ? (
              <Button
                title={he.dtfClear}
                variant="outline"
                size="sm"
                onPress={onClear}
              />
            ) : <View />}
            <View style={styles.modalFooterRight}>
              <Button
                title={he.cancel}
                variant="outline"
                size="sm"
                onPress={onClose}
              />
              <Button
                title={he.dtfConfirm}
                variant="primary"
                size="sm"
                onPress={() =>
                  onConfirm(`${pad2(h)}:${pad2(snapMinuteNum(m))}`)
                }
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DatePickerModal({
  visible,
  initial,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  initial: number;
  onClose: () => void;
  onConfirm: (ts: number) => void;
}) {
  const [view, setView] = useState(() => startOfMonth(initial));
  const [picked, setPicked] = useState(() => initial);
  React.useEffect(() => {
    if (visible) {
      setView(startOfMonth(initial));
      setPicked(initial);
    }
  }, [visible, initial]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}
        >
          <CalendarHeader
            month={view}
            onPrev={() => setView(addMonths(view, -1))}
            onNext={() => setView(addMonths(view, 1))}
          />
          <CalendarGrid
            month={view}
            picked={picked}
            onPick={setPicked}
          />
          <View style={styles.modalFooter}>
            <View />
            <View style={styles.modalFooterRight}>
              <Button
                title={he.cancel}
                variant="outline"
                size="sm"
                onPress={onClose}
              />
              <Button
                title={he.dtfConfirm}
                variant="primary"
                size="sm"
                onPress={() => onConfirm(picked)}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DateTimePickerModal({
  visible,
  initial,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  initial: number;
  onClose: () => void;
  onConfirm: (ts: number) => void;
}) {
  const [view, setView] = useState(() => startOfMonth(initial));
  const [picked, setPicked] = useState(() => initial);
  React.useEffect(() => {
    if (visible) {
      setView(startOfMonth(initial));
      setPicked(initial);
    }
  }, [visible, initial]);

  const hh = new Date(picked).getHours();
  const mm = new Date(picked).getMinutes();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}
        >
          <CalendarHeader
            month={view}
            onPrev={() => setView(addMonths(view, -1))}
            onNext={() => setView(addMonths(view, 1))}
          />
          <CalendarGrid
            month={view}
            picked={picked}
            onPick={(ts) => setPicked(applyTime(ts, hh, mm))}
          />
          <View style={styles.timeStrip}>
            <Text style={styles.timeStripLabel}>{he.dtfTime}</Text>
            <View style={styles.wheelRow}>
              <WheelColumn
                values={Array.from({ length: 24 }, (_, i) => pad2(i))}
                selected={pad2(hh)}
                onSelect={(v) =>
                  setPicked(applyTime(picked, parseInt(v, 10), mm))
                }
                short
              />
              <Text style={styles.wheelSep}>:</Text>
              <WheelColumn
                values={Array.from(
                  { length: 60 / MINUTE_STEP },
                  (_, i) => pad2(i * MINUTE_STEP),
                )}
                selected={snapMinute(mm)}
                onSelect={(v) =>
                  setPicked(applyTime(picked, hh, parseInt(v, 10)))
                }
                short
              />
            </View>
          </View>
          <View style={styles.modalFooter}>
            <View />
            <View style={styles.modalFooterRight}>
              <Button
                title={he.cancel}
                variant="outline"
                size="sm"
                onPress={onClose}
              />
              <Button
                title={he.dtfConfirm}
                variant="primary"
                size="sm"
                onPress={() => onConfirm(picked)}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function CalendarHeader({
  month,
  onPrev,
  onNext,
}: {
  month: Date;
  onPrev: () => void;
  onNext: () => void;
}) {
  const label = `${HEBREW_MONTHS[month.getMonth()]} ${month.getFullYear()}`;
  return (
    <View style={styles.calHeader}>
      <Pressable onPress={onPrev} hitSlop={8} style={styles.calNav}>
        <Ionicons name="chevron-forward" size={20} color={colors.text} />
      </Pressable>
      <Text style={styles.calHeaderText}>{label}</Text>
      <Pressable onPress={onNext} hitSlop={8} style={styles.calNav}>
        <Ionicons name="chevron-back" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

function CalendarGrid({
  month,
  picked,
  onPick,
}: {
  month: Date;
  picked: number;
  onPick: (ts: number) => void;
}) {
  const cells = useMemo(() => buildMonthCells(month), [month]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pickedDate = new Date(picked);
  pickedDate.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();
  const pickedTs = pickedDate.getTime();

  return (
    <View>
      <View style={styles.daysHeaderRow}>
        {HEBREW_DAY_HEADERS.map((d) => (
          <Text key={d} style={styles.daysHeaderCell}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.daysGrid}>
        {cells.map((cell, i) => {
          const inMonth = cell.getMonth() === month.getMonth();
          const isToday = cell.getTime() === todayTs;
          const isPicked = cell.getTime() === pickedTs;
          return (
            <Pressable
              key={i}
              disabled={!inMonth}
              onPress={() => onPick(applyTimeFromTs(cell.getTime(), picked))}
              style={[
                styles.dayCell,
                isPicked && styles.dayCellPicked,
                isToday && !isPicked && styles.dayCellToday,
              ]}
            >
              <Text
                style={[
                  styles.dayText,
                  !inMonth && { color: colors.border },
                  isPicked && styles.dayTextPicked,
                ]}
              >
                {cell.getDate()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function WheelColumn({
  values,
  selected,
  onSelect,
  short,
}: {
  values: string[];
  selected: string;
  onSelect: (v: string) => void;
  short?: boolean;
}) {
  const ref = useRef<ScrollView>(null);
  const idx = Math.max(0, values.indexOf(selected));
  // Center the selected row inside the wheel viewport.
  const initialOffset = idx * ROW_H;
  const visible = short ? 3 : VISIBLE_ROWS;
  const colHeight = ROW_H * visible;
  const padding = ROW_H * Math.floor(visible / 2);

  // Scroll to selection on selection change.
  React.useEffect(() => {
    requestAnimationFrame(() => {
      ref.current?.scrollTo({ y: initialOffset, animated: false });
    });
  }, [initialOffset]);

  return (
    <View style={[styles.wheelColumn, { height: colHeight }]}>
      <View pointerEvents="none" style={styles.wheelHighlight} />
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW_H}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: padding }}
        onMomentumScrollEnd={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          const i = Math.round(y / ROW_H);
          const v = values[Math.max(0, Math.min(values.length - 1, i))];
          onSelect(v);
        }}
      >
        {values.map((v) => (
          <Pressable
            key={v}
            onPress={() => onSelect(v)}
            style={styles.wheelRowItem}
          >
            <Text
              style={[
                styles.wheelText,
                v === selected && styles.wheelTextActive,
              ]}
            >
              {v}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function parseTime(hhmm: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return { h: 20, m: 0 };
  return {
    h: clamp(parseInt(m[1], 10), 0, 23),
    m: clamp(parseInt(m[2], 10), 0, 59),
  };
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function snapMinute(m: number): string {
  return pad2(snapMinuteNum(m));
}
function snapMinuteNum(m: number): number {
  return Math.round(m / MINUTE_STEP) * MINUTE_STEP;
}
function startOfMonth(ts: number): Date {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function buildMonthCells(month: Date): Date[] {
  // Builds 6×7 = 42 cells starting from the Sunday on/before the 1st.
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(start.getDate() - first.getDay());
  const out: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    d.setHours(0, 0, 0, 0);
    out.push(d);
  }
  return out;
}
function applyTime(ts: number, h: number, m: number): number {
  const d = new Date(ts);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}
function applyTimeFromTs(dateTs: number, fromTs: number): number {
  const f = new Date(fromTs);
  return applyTime(dateTs, f.getHours(), f.getMinutes());
}
function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${formatDate(ts)} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textMuted },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  value: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
  },

  // Modal
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'right',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  modalFooterRight: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  // Wheels
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  wheelColumn: {
    width: 80,
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    position: 'relative',
  },
  wheelHighlight: {
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -ROW_H / 2 }],
    left: 0,
    right: 0,
    height: ROW_H,
    backgroundColor: colors.primaryLight,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.primary,
    opacity: 0.6,
  },
  wheelRowItem: {
    height: ROW_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelText: {
    ...typography.body,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  wheelTextActive: {
    color: colors.text,
    fontWeight: '700',
  },
  wheelSep: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '700',
  },

  // Calendar
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  calHeaderText: {
    ...typography.bodyBold,
    color: colors.text,
  },
  calNav: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  daysHeaderRow: {
    flexDirection: 'row',
    paddingVertical: spacing.xs,
  },
  daysHeaderCell: {
    flex: 1,
    textAlign: 'center',
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  dayCellPicked: {
    backgroundColor: colors.primary,
    borderRadius: 999,
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 999,
  },
  dayText: {
    ...typography.body,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  dayTextPicked: {
    color: '#fff',
    fontWeight: '700',
  },

  // Compact time strip in date+time modal
  timeStrip: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  timeStripLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
  },
});
