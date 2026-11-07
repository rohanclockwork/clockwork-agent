// The claims guard: every reply is checked before a shopper sees it.
const RULES = [
  [/\b(repair|repairs|repaired|repairing|rebuild|rebuilds|rebuilt|rebuilding|restore[sd]?|restoring|heal|heals|healed|healing|reverse[sd]?|reversing|cure[sd]?|curing|regrow\w*)\b/i, 'therapeutic verb'],
  [/\bstrengthen(s|ed|ing)?\b[^.]{0,40}\b(enamel|teeth|tooth)\b/i, 'strengthens enamel'],
  [/\bnon[- ]?toxic\b|\bzero toxins?\b|\btoxin[- ]free\b/i, 'non-toxic'],
  [/\bchemical[- ]free\b|\b100\s?% natural\b|\ball[- ]natural\b/i, 'chemical free / 100% natural'],
  [/\bcompletely safe\b|\bsafe (for kids|for children|to swallow|if swallowed)\b|\b100\s?% safe\b/i, 'absolute safety'],
  [/\bclinically (proven|tested)\b/i, 'clinically proven'],
  [/\bdentists? (recommend|recommended|approved|approve)\b|\brecommended by dentists\b/i, 'dentist recommended'],
  [/\bpatented\b/i, 'patented'],
  [/\bindia'?s (#\s?1|no\.?\s?1|number one|first|1st|best)\b/i, "India's #1 / first"],
  [/\bpremium\b|\bgold standard\b|\bbest[- ]in[- ]class\b|\bthe best\b/i, 'superlative'],
  [/\b\d+(\.\d+)?\s?%\s*(nano[- ]?hydroxyapatite|hydroxyapatite|nhap|n-?ha|hydroxy)\b/i, 'percentage next to hydroxyapatite'],
  [/hydroxy™?\s*\d|\d+\s?%\s*hydroxy™/i, 'HydroXy with a percentage'],
  [/\b(anti[- ]?cavity|cavity protection|prevents? (cavities|decay|tooth decay)|fights? cavities)\b/i, 'anti-cavity claim'],
  [/\b(relieves?|stops?|eliminates?|cures?) (sensitivity|tooth sensitivity|pain)\b/i, 'sensitivity relief claim'],
  [/\bwhiten(s|ing)? (your )?teeth\b/i, 'whitening claim'],
  [/\b(?!FLUIDINOVA\b)[Ff][Ll][Uu][Ii][Dd][Ii][Nn][Oo][Vv][Aa]\b/, 'FLUIDINOVA must be in capitals'],
];
// These apply even inside an allowed sentence (a trial description must still never put a percentage next to hydroxyapatite).
const HARD = new Set(['percentage next to hydroxyapatite', 'HydroXy with a percentage', 'FLUIDINOVA must be in capitals']);
// Allowed contexts that would otherwise trip a rule.
const ALLOW = [/\b(cannot|can't|can not|doesn't|does not|won't|will not|never|no)\b[^.]{0,40}\b(rebuil|regrow|repair|restor|heal|cure|revers)/i, /helps remineralise/i, /not (a )?(cure|treatment)/i, /we (don't|do not|won't|will not|never) (say|claim|call)/i, /isn't clinically proven|not clinically proven|no completed clinical trial/i, /\b(trial|Paszynska)\b[^.]*\b(non-inferior|as good as|fluoride toothpaste)/i];

export function check(text) {
  const problems = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const allowed = ALLOW.some(a => a.test(s));
    for (const [re, why] of RULES) if ((!allowed || HARD.has(why)) && re.test(s)) problems.push({ why, sentence: s.slice(0, 160) });
  }
  return { ok: problems.length === 0, problems };
}

export const FALLBACK = "I want to get that exactly right, so here is our guide that covers it with sources: /pages/guides. If you'd like, I can also put you in touch with the team on WhatsApp.";
