import React from 'react';
import { ActivityIndicator, ImageBackground, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeModal } from '@/components/SafeModal';
import { SafeKeyboardAvoidingView } from '@/components/SafeKeyboardAvoidingView';
import { colors, RTL_LABEL_ALIGN, typography } from '@/theme';
import { overlayTheme } from '@/theme/overlays';
import { FEEDBACK_PROMPT_MAX_LENGTH } from '@/services/feedbackPromptService';

export interface FeedbackPromptDialogProps {
  message: string;
  busy: boolean;
  error: string;
  success: boolean;
  onChange: (message: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

/** Presentation only. The host owns identity, delivery and frequency. */
export function FeedbackPromptDialog({ message, busy, error, success, onChange, onSubmit, onClose }: FeedbackPromptDialogProps) {
  const close = onClose;
  return <SafeModal visible transparent animationType="fade" onRequestClose={close}>
    <SafeKeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.dialog} accessibilityViewIsModal>
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <ImageBackground source={require('../../../assets/feedback/prompt-football-banner.png')} style={styles.hero} resizeMode="cover" accessible={false}>
            <LinearGradient colors={['rgba(4,20,43,0.1)', 'rgba(4,20,43,0.75)']} style={StyleSheet.absoluteFill} />
            <Text style={styles.eyebrow}>בשביל הכדורגל שלכם</Text>
            <Text style={styles.title}>גם מחוץ למגרש,{ '\n' }אנחנו איתכם.</Text>
          </ImageBackground>
          <View style={styles.body}>
            {success ? <View accessibilityLiveRegion="polite">
              <Text style={styles.question}>תודה, חבר'ה!</Text>
              <Text style={styles.copy}>ההצעה שלכם הגיעה אלינו. שמחים שאתם איתנו ועוזרים לנו לשפר את האפליקציה.</Text>
            </View> : <>
              <Text style={styles.copy}>אנחנו עובדים מסביב לשעון כדי שיהיה לכם יותר פשוט לארגן מחזור, להביא את החבר'ה ולעלות לשחק.</Text>
              <Text style={styles.copy}>ובדרך, אנחנו כאן להקשיב ולעזור כשמשהו נתקע.</Text>
              <Text style={styles.question}>מה עוד חסר לכם באפליקציה?</Text>
              <Text style={styles.helper}>מה יעשה לכם את הכדורגל קצת יותר קל וכיף?</Text>
              <TextInput accessibilityLabel="מה עוד חסר לכם באפליקציה?" placeholder="כאן המקום לרעיון שלכם..." placeholderTextColor={colors.textMuted}
                value={message} onChangeText={onChange} multiline maxLength={FEEDBACK_PROMPT_MAX_LENGTH} editable={!busy}
                style={styles.input} textAlignVertical="top" />
              <View style={styles.hintRow}>
                <Text style={styles.hint}>גם רעיון קטן יכול לעשות הבדל.</Text>
                <Text style={styles.counter}>{message.length} / {FEEDBACK_PROMPT_MAX_LENGTH}</Text>
              </View>
              {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
            </>}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" accessibilityLabel={success ? 'בחזרה לאפליקציה' : 'שליחה'}
            accessibilityState={{ disabled: busy || (!success && !message.trim()), busy }}
            disabled={busy || (!success && !message.trim())} onPress={success ? close : onSubmit}
            style={[styles.send, (busy || (!success && !message.trim())) && styles.disabled]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>{success ? 'בחזרה לאפליקציה' : 'שליחה'}</Text>}
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="סגירה" onPress={close} style={styles.close}>
          <Ionicons name="close" size={22} color="#fff" />
        </Pressable>
      </View>
    </SafeKeyboardAvoidingView>
  </SafeModal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: overlayTheme.backdrop },
  dialog: { width: '100%', maxWidth: 420, maxHeight: '94%', backgroundColor: colors.surface, borderRadius: 24, overflow: 'hidden' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { flexGrow: 0 },
  hero: { minHeight: 195, justifyContent: 'flex-end', padding: 22, paddingTop: 62, backgroundColor: '#071C35' },
  eyebrow: { ...typography.caption, fontWeight: '600', color: '#fff', textAlign: RTL_LABEL_ALIGN, marginBottom: 8 },
  title: { ...typography.h1, fontSize: 26, lineHeight: 34, color: '#fff', textAlign: RTL_LABEL_ALIGN },
  body: { paddingHorizontal: 22, paddingTop: 20 },
  copy: { ...typography.body, fontSize: 15, lineHeight: 23, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginBottom: 12 },
  question: { ...typography.bodyBold, color: colors.text, textAlign: RTL_LABEL_ALIGN, marginTop: 8, marginBottom: 6 },
  helper: { ...typography.caption, lineHeight: 20, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginBottom: 12 },
  input: { ...typography.body, color: colors.text, textAlign: 'right', backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14, minHeight: 96, maxHeight: 150 },
  hintRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 8 },
  hint: { ...typography.caption, fontSize: 11, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  counter: { ...typography.caption, fontSize: 11, color: colors.textMuted, writingDirection: 'ltr' },
  footer: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 22 },
  send: { minHeight: 50, borderRadius: 14, padding: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.primary },
  disabled: { opacity: 0.6 },
  sendText: { ...typography.button, color: '#fff', textAlign: 'center' },
  close: { position: 'absolute', top: 10, right: 10, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(4,20,43,0.4)' },
  error: { ...typography.caption, color: colors.danger, textAlign: RTL_LABEL_ALIGN, marginVertical: 8 },
});
