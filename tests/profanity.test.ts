// Profanity filter — pins that real profanity is still blocked while innocent
// Hebrew words that merely CONTAIN a short banned root are NOT over-blocked
// (the substring-match false positives: בנזין⊃זין, הומור⊃הומו, אחראי⊃חרא).
import { containsProfanity } from '@/data/profanity';

describe('containsProfanity', () => {
  it('blocks direct profanity', () => {
    expect(containsProfanity('זין')).toBe(true);
    expect(containsProfanity('חרא של משחק')).toBe(true);
    expect(containsProfanity('אתה שרמוטה')).toBe(true);
    expect(containsProfanity('בן זונה')).toBe(true);
    expect(containsProfanity('fuck this')).toBe(true);
    expect(containsProfanity('go fuck yourself')).toBe(true);
  });

  it('still catches padded / punctuated forms of short roots', () => {
    expect(containsProfanity('זייןןן')).toBe(true); // repeats collapse → זין
    expect(containsProfanity('זין!')).toBe(true); // punctuation stripped
  });

  it('does NOT over-block innocent Hebrew words containing a short root', () => {
    expect(containsProfanity('מי מביא בנזין למגרש')).toBe(false); // בנזין ⊃ זין
    expect(containsProfanity('יש לו הומור טוב')).toBe(false); // הומור ⊃ הומו
    expect(containsProfanity('אני אחראי על הכדורים')).toBe(false); // אחראי ⊃ חרא
    expect(containsProfanity('מגזין ספורט')).toBe(false); // מגזין ⊃ זין
    expect(containsProfanity('נהדר, נתראה במגרש')).toBe(false);
  });
});
