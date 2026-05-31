# Teamder — Privacy Nutrition Labels (App Store Connect)

Apple's "App Privacy" questionnaire is required for EVERY app. Answer these
exactly as below in App Store Connect → App Privacy → "Manage" → Add
Data Type.

Each answer reflects what the actual code does (verified via static audit of
`src/services/*.ts`, `app.json`, and `package.json`).

---

## 📋 Quick map: which screens trigger what

| Data type | First triggered on | Required by feature |
|---|---|---|
| Email | Onboarding (Google sign-in) | Auth, profile |
| Display name | Onboarding | Profile, social |
| Photo | Profile edit (optional) | Avatar, cover photo |
| City / coarse location | Onboarding (optional), Community filter | "Nearby" filter |
| Device contacts | NEVER | Not used |
| Microphone | NEVER | Not used |
| Health data | NEVER | Not used |
| Crash reports | Always | Firebase Crashlytics |
| Performance data | Always | Firebase Performance (if enabled) |
| Analytics events | Always | Firebase Analytics |
| Ad identifiers | When ads shown | AdMob |

---

## 🛠️ Step-by-step in App Store Connect

In **App Store Connect → My Apps → Teamder → App Privacy**, you'll click
**"Get Started"** then walk through each Data Type and answer the
questions below.

### 1️⃣ "Do you or your third-party partners collect data from this app?"
→ **YES** *(because of Firebase + AdMob)*

### 2️⃣ Then add EACH of the following data types:

---

## 🟦 Contact Info — Email Address

- **Is this data collected?** YES
- **Is it linked to the user's identity?** YES *(part of their Teamder account)*
- **Is it used for tracking?** NO
- **Purposes** (check all that apply):
  - ✅ App Functionality
  - ✅ Analytics *(via Firebase user_id → email mapping in Crashlytics only)*
- **NOT** for advertising, personalisation, product personalisation,
  or 3rd-party advertising.

---

## 🟦 Contact Info — Name

- **Collected:** YES
- **Linked to user:** YES
- **Tracking:** NO
- **Purposes:**
  - ✅ App Functionality

---

## 🟦 Contact Info — Phone Number

- **Collected:** YES (optional; only when community admin sets it for WhatsApp contact)
- **Linked to user:** YES
- **Tracking:** NO
- **Purposes:**
  - ✅ App Functionality

---

## 🟦 User Content — Photos

- **Collected:** YES (only avatar + community cover photos)
- **Linked to user:** YES
- **Tracking:** NO
- **Purposes:**
  - ✅ App Functionality

---

## 🟦 User Content — Other User Content

- **Collected:** YES
- **Linked to user:** YES
- **Tracking:** NO
- **Purposes:**
  - ✅ App Functionality

*(This covers: game titles, community descriptions, notes, chat messages
if you add chat later.)*

---

## 🟦 Location — Coarse Location

- **Collected:** YES *(via the "Nearby" community filter)*
- **Linked to user:** NO *(processed on-device; only the city name is
  ever sent to Firestore as `availability.preferredCity`, no raw lat/lng)*
- **Tracking:** NO
- **Purposes:**
  - ✅ App Functionality

⚠️ If you keep the new radius-based "nearby" filter (lat/lng stored on
the group document), CHANGE this to **Linked to User: YES**.

---

## 🟦 Identifiers — User ID

- **Collected:** YES
- **Linked to user:** YES
- **Tracking:** NO
- **Purposes:**
  - ✅ App Functionality
  - ✅ Analytics

---

## 🟦 Identifiers — Device ID *(only if AdMob enabled)*

- **Collected:** YES
- **Linked to user:** NO
- **Tracking:** YES *(IDFA for ad attribution)*
- **Purposes:**
  - ✅ Third-Party Advertising

⚠️ Triggering "Tracking" means iOS will show the **ATT prompt** ("Allow
Teamder to track your activity?") on first launch. Make sure your
`NSUserTrackingUsageDescription` string in `app.json` is written
honestly — Apple rejects misleading ones.

Recommended copy:
```
לתת לך פרסומות רלוונטיות יותר ולשמור על Teamder חינמי.
```

---

## 🟦 Usage Data — Product Interaction

- **Collected:** YES *(via Firebase Analytics — GroupSearch, GameCreated,
  GroupJoinRequested etc.)*
- **Linked to user:** YES
- **Tracking:** NO
- **Purposes:**
  - ✅ Analytics
  - ✅ Product Personalisation *(if you tailor "discover" based on past joins)*

---

## 🟦 Usage Data — Advertising Data *(only if AdMob enabled)*

- **Collected:** YES
- **Linked to user:** NO
- **Tracking:** YES
- **Purposes:**
  - ✅ Third-Party Advertising

---

## 🟦 Diagnostics — Crash Data

- **Collected:** YES *(Firebase Crashlytics)*
- **Linked to user:** YES *(stack traces include the user id)*
- **Tracking:** NO
- **Purposes:**
  - ✅ App Functionality
  - ✅ Analytics

---

## 🟦 Diagnostics — Performance Data

- **Collected:** YES *(if Firebase Performance Monitoring is enabled)*
- **Linked to user:** NO
- **Tracking:** NO
- **Purposes:**
  - ✅ Analytics

---

## ❌ Data Types NOT Collected (don't add to App Store Connect)

- Health & Fitness
- Financial Info (no payments, no credit cards stored)
- Sensitive Info (no race, religion, sexual orientation, biometrics)
- Contacts
- Browsing History
- Search History
- Microphone audio
- Body data (heart rate etc.)
- Location — Precise *(unless you switch to GPS-tagged groups later)*

---

## 🌐 Privacy Policy URL

Apple will ask for a URL. You'll need to host the privacy policy somewhere
publicly accessible. Options:

1. **GitHub Pages / Firebase Hosting** — if `public/privacy.html` is
   already deployed, link to that (`https://teamder.app/privacy.html`)
2. **Notion public page** — fast fallback
3. **Wix / Squarespace** — overkill

The privacy policy ITSELF needs to be in Hebrew (your primary locale).
You have `public/privacy.html` in the repo — review it before submitting.

---

## 🔐 Sign-in & Account Deletion

Apple requires (since 2022) that any app with account creation must
support **in-app account deletion**. Teamder has this — confirm before
submitting:

- ✅ `src/firebase/auth.ts` exports `deleteAccount()`
- ✅ Settings → Account → Delete account button wired

If a TestFlight reviewer can't find the delete button in 60 seconds,
they reject. Make sure it's not buried in a sub-sub-menu.

---

## 📌 Submission checklist (before you hit "Submit for Review")

- [ ] All 11 data types above answered in App Store Connect
- [ ] Privacy policy URL filled in and publicly accessible
- [ ] `NSUserTrackingUsageDescription` set in app.json (if ads on)
- [ ] `NSLocationWhenInUseUsageDescription` set (Nearby filter)
- [ ] `NSPhotoLibraryUsageDescription` set (avatar upload)
- [ ] `NSCameraUsageDescription` set (avatar from camera)
- [ ] Account delete flow accessible within 3 taps from main UI
- [ ] App icon 1024×1024 (no transparency, no rounded corners — Apple adds them)
- [ ] At least 1 iPhone 6.7" screenshot uploaded
- [ ] App description, keywords, subtitle filled
