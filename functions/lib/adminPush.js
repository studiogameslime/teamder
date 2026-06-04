"use strict";
// Shared FCM sender for founder alerts. Honors the per-type on/off toggles the
// Pulse dashboard writes to adminConfig/prefs (server-side filtering, because
// the push fires even when the app is closed). Default = enabled.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushToAdmins = pushToAdmins;
const admin = __importStar(require("firebase-admin"));
async function pushToAdmins(type, title, body, data = {}) {
    const db = admin.firestore();
    const messaging = admin.messaging();
    // Per-type mute switch (default on when missing).
    try {
        const prefs = (await db.collection('adminConfig').doc('prefs').get()).data();
        if (prefs && prefs[type] === false)
            return;
    }
    catch {
        /* default enabled */
    }
    let tokens = [];
    try {
        const cfg = await db.collection('adminConfig').doc('push').get();
        tokens = (cfg.data()?.tokens ?? []).filter(Boolean);
    }
    catch (err) {
        console.warn('[pushToAdmins] token read failed', err);
    }
    if (!tokens.length)
        return;
    try {
        const res = await messaging.sendEachForMulticast({
            tokens,
            notification: { title, body },
            data: { ...data, type },
            android: { priority: 'high', notification: { sound: 'default' } },
            apns: { payload: { aps: { sound: 'default' } } },
        });
        const dead = tokens.filter((_, i) => {
            const c = res.responses[i]?.error?.code;
            return (c === 'messaging/registration-token-not-registered' ||
                c === 'messaging/invalid-argument');
        });
        if (dead.length) {
            await db
                .collection('adminConfig')
                .doc('push')
                .update({ tokens: admin.firestore.FieldValue.arrayRemove(...dead) });
        }
    }
    catch (err) {
        console.error('[pushToAdmins] send failed', err);
    }
}
