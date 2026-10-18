import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';
import { signInPulseEmail, signInPulseGoogle } from '../services/adminSession';

export function AdminLoginScreen() {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const login = async (google: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try { if (google) await signInPulseGoogle(); else await signInPulseEmail(email, password); setPassword(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'ההתחברות לא הצליחה'); }
    finally { setBusy(false); }
  };
  return <View style={styles.screen}>
    <Text style={styles.title}>פולס</Text>
    <Text style={styles.help}>כניסה מאובטחת לחשבון מנהל מורשה</Text>
    <TextInput accessibilityLabel="כתובת דואר אלקטרוני" style={styles.input} placeholder="דואר אלקטרוני" placeholderTextColor={colors.textMuted} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" editable={!busy} />
    <TextInput accessibilityLabel="סיסמה" style={styles.input} placeholder="סיסמה" placeholderTextColor={colors.textMuted} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" editable={!busy} />
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Pressable disabled={busy || !email || !password} onPress={() => void login(false)} style={[styles.button, (busy || !email || !password) && { opacity: 0.5 }]}><Text style={styles.buttonText}>כניסה</Text></Pressable>
    <Pressable disabled={busy} onPress={() => void login(true)} style={styles.google}><Text style={styles.buttonText}>כניסה עם גוגל</Text></Pressable>
    {busy && <ActivityIndicator color={colors.primary} />}
    <Text style={styles.help}>הגישה מיועדת לחשבונות שאושרו מראש בלבד</Text>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 28, gap: 14, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', textAlign: 'center' },
  help: { color: colors.textSoft, fontSize: 14, textAlign: 'center' },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16, color: colors.text, textAlign: 'right' },
  button: { backgroundColor: colors.primary, borderRadius: 14, padding: 16 },
  google: { borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16 },
  buttonText: { color: colors.text, textAlign: 'center', fontWeight: '700' },
  error: { color: colors.red, textAlign: 'right' },
});
