import AsyncStorage from '@react-native-async-storage/async-storage';
import { encryptedPersistence } from '../utils/encryptedPersistence';

// Lazy native import keeps mock-mode tooling independent of the native module.
const native = () => require('expo-secure-store') as typeof import('expo-secure-store');
const crypto = () => require('expo-crypto') as typeof import('expo-crypto');
const options = () => ({ keychainAccessible: native().AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
export const secureAuthStorage = encryptedPersistence({
  getItem: key => native().getItemAsync(key, options()),
  setItem: (key, value) => native().setItemAsync(key, value, options()),
  removeItem: key => native().deleteItemAsync(key, options()),
}, AsyncStorage, key => crypto().digestStringAsync(crypto().CryptoDigestAlgorithm.SHA256, key), () => crypto().randomUUID());
