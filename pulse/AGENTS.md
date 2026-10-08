# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

---

# The work list — how "עבור על הפתוחים" works

**מסך המשימות is the only inbox.** It shows every stream at once: משימות
(`tasks`), דיווחים (`feedback`), שגיאות (`errors`), פיצ׳רים (`pulseFeatures`)
and רעיונות (`pulseIdeas`). When the owner says "go over the open items" /
"לעבור על המשימות", that means **everything on that screen**, not one stream.

Nothing was migrated. Each item still lives in its own collection under its own
status vocabulary; `src/services/workItems.ts` merges them on READ. Every other
screen and counter still works untouched.

## The one thing NOT to act on

An idea still parked as **`status: 'idea'` (רעיון)** is the owner's to
characterise before anyone builds from it. Skip it. The row says so, and
`claudeQueue()` in `workItems.ts` already filters it out — use that rather than
re-deriving the rule.

- `idea` (רעיון) → **hands off**
- `spec` (לאיפיון) → write the spec
- `build` (לביצוע) → build it

## Finishing an item

Never flip an item's own `status` to closed. Closing is the OWNER's act, after
he has read what changed. Write the handover instead — four fields, on whatever
document the item lives in:

```
claudeStatus: 'done'
claudeNote:   what was actually fixed / changed, in Hebrew
claudeImages: [ base64 JPEG, no `data:` prefix ]   // proof, downscaled
claudeAt:     Date.now()
```

The item then appears under **בוצע ע״י קלוד**, keeps counting as open
everywhere else (it is waiting for review), and the owner accepts it with
"אישור וסגירה" — which is what finally writes the closed status, in the word
that collection speaks (`errors` → `'resolved'`, everything else → `'done'`).

⚠️ Do NOT put `done_by_claude` in the `status` field. `openInboxCounts()` and
the badge queries compute open work as `total − countWhereEquals(status,
closed)`, so an unrecognised status silently leaves the item counted as open
forever. `src/services/claudeWork.ts` explains this at length.

**A note without proof is not finished.** Attach a screenshot. If the state you
need cannot be reached — because production has not produced it yet — add it to
`src/services/workItemsMock.ts` and flip `MOCK_WORK` in `src/config.ts`, look,
flip it back. "I couldn't screenshot it because there was no data" is not an
acceptable answer.

**Only claim what you actually did.** The whole point of the state is that the
owner reviews it; a false claim costs more than no claim.

## Building

Bump `versionCode` in `android/app/build.gradle` on every APK, or Android
refuses to install over the previous one.
