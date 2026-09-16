"use strict";
// seasonSeed — server-side mirror of `src/utils/seasonSeed.ts`.
//
// ---- everything below this line is a copy of the client file ----
Object.defineProperty(exports, "__esModule", { value: true });
exports.seasonSeed = seasonSeed;
// Where a season starts counting.
//
// A season starts at ZERO — always, including a club's first. It used to seed
// season 1 with the club's history, read from a counter that only began when
// evening-sealing shipped, so a club that had played 19 evenings was shown
// "7 מתוך 24": not its history, not a fresh start, just however far that
// counter happened to have got.
//
// Progress is `sealedEvenings - roundsAtStart`, so the two fields below MUST be
// derived from the same instant. Seeding the offset from a stale value while
// showing 0 gives a season that reads "0 מתוך 24" and closes after 17.
const num = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
function seasonSeed(sealedEvenings) {
    return { roundsAtStart: num(sealedEvenings), playedRounds: 0 };
}
