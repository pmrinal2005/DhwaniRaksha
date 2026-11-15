/**
 * Deterministic Indic text normalisation for TTS input.
 *
 * Gnani's own Text Normalisation Guide says raw digits / IDs / currency are handled
 * automatically — but it also documents the failure modes (`auto` reads Latin-only
 * text as English, ID digit-runs are read digit-by-digit, `₹4,312.50` becomes
 * "rupees and paise"). For a voice ledger every rupee must be spoken identically
 * on every call, so we expand before synthesis and hash the expanded string.
 *
 * Languages with full cardinal morphology: Hindi, Marathi, English.
 * Other locales use digit-word + scale-word joining (always intelligible, never
 * falls back to raw digits). Everything is pure and synchronous.
 */

export type NormalizerLocale = "hi-IN" | "en-IN" | "ta-IN" | "te-IN" | "kn-IN" | "ml-IN" | "mr-IN" | "pa-IN" | "bn-IN" | "gu-IN" | "hi-en";

interface NumberWords {
  digits: readonly string[];
  units: readonly string[];      // 0..19
  tens: readonly string[];       // 20,30,...,90
  hundred: string;
  thousand: string;
  lakh: string;
  crore: string;
  join?: (tens: string, unit: string) => string;
}

const ENGLISH: NumberWords = {
  digits: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"],
  units: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"],
  tens: ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"],
  hundred: "hundred", thousand: "thousand", lakh: "lakh", crore: "crore",
  join: (ten, unit) => `${ten}-${unit}`,
};

const HINDI: NumberWords = {
  digits: ["शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ"],
  units: ["शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस"],
  tens: ["", "", "बीस", "तीस", "चालीस", "पचास", "साठ", "सत्तर", "अस्सी", "नब्बे"],
  hundred: "सौ", thousand: "हज़ार", lakh: "लाख", crore: "करोड़",
};

const MARATHI: NumberWords = {
  digits: ["शून्य", "एक", "दोन", "तीन", "चार", "पाच", "सहा", "सात", "आठ", "नऊ"],
  units: ["शून्य", "एक", "दोन", "तीन", "चार", "पाच", "सहा", "सात", "आठ", "नऊ", "दहा", "अकरा", "बारा", "तेरा", "चौदा", "पंधरा", "सोळा", "सतरा", "अठरा", "एकोणीस"],
  tens: ["", "", "वीस", "तीस", "चाळीस", "पन्नास", "साठ", "सत्तर", "ऐंशी", "नव्वद"],
  hundred: "शे", thousand: "हजार", lakh: "लाख", crore: "कोटी",
};

const TAMIL: NumberWords = {
  digits: ["பூஜ்யம்", "ஒன்று", "இரண்டு", "மூன்று", "நான்கு", "ஐந்து", "ஆறு", "ஏழு", "எட்டு", "ஒன்பது"],
  units: ["பூஜ்யம்", "ஒன்று", "இரண்டு", "மூன்று", "நான்கு", "ஐந்து", "ஆறு", "ஏழு", "எட்டு", "ஒன்பது", "பத்து", "பதினொன்று", "பன்னிரண்டு", "பதிமூன்று", "பதினான்கு", "பதினைந்து", "பதினாறு", "பதினேழு", "பதினெட்டு", "பத்தொன்பது"],
  tens: ["", "", "இருபது", "முப்பது", "நாற்பது", "ஐம்பது", "அறுபது", "எழுபது", "எண்பது", "தொண்ணூறு"],
  hundred: "நூறு", thousand: "ஆயிரம்", lakh: "லட்சம்", crore: "கோடி",
};

const TELUGU: NumberWords = {
  digits: ["సున్నా", "ఒకటి", "రెండు", "మూడు", "నాలుగు", "ఐదు", "ఆరు", "ఏడు", "ఎనిమిది", "తొమ్మిది"],
  units: ["సున్నా", "ఒకటి", "రెండు", "మూడు", "నాలుగు", "ఐదు", "ఆరు", "ఏడు", "ఎనిమిది", "తొమ్మిది", "పది", "పదకొండు", "పన్నెండు", "పదమూడు", "పద్నాలుగు", "పదిహేను", "పదహారు", "పదిహేడు", "పద్దెనిమిది", "పంతొమ్మిది"],
  tens: ["", "", "ఇరవై", "ముప్పై", "నలభై", "యాభై", "అరవై", "డెబ్బై", "ఎనభై", "తొంభై"],
  hundred: "వంద", thousand: "వెయ్యి", lakh: "లక్ష", crore: "కోటి",
};

const KANNADA: NumberWords = {
  digits: ["ಸೊನ್ನೆ", "ಒಂದು", "ಎರಡು", "ಮೂರು", "ನಾಲ್ಕು", "ಐದು", "ಆರು", "ಏಳು", "ಎಂಟು", "ಒಂಬತ್ತು"],
  units: ["ಸೊನ್ನೆ", "ಒಂದು", "ಎರಡು", "ಮೂರು", "ನಾಲ್ಕು", "ಐದು", "ಆರು", "ಏಳು", "ಎಂಟು", "ಒಂಬತ್ತು", "ಹತ್ತು", "ಹನ್ನೊಂದು", "ಹನ್ನೆರಡು", "ಹದಿಮೂರು", "ಹದಿನಾಲ್ಕು", "ಹದಿನೈದು", "ಹದಿನಾರು", "ಹದಿನೇಳು", "ಹದಿನೆಂಟು", "ಹತ್ತೊಂಬತ್ತು"],
  tens: ["", "", "ಇಪ್ಪತ್ತು", "ಮೂವತ್ತು", "ನಲವತ್ತು", "ಐವತ್ತು", "ಅರವತ್ತು", "ಎಪ್ಪತ್ತು", "ಎಂಬತ್ತು", "ತೊಂಬತ್ತು"],
  hundred: "ನೂರು", thousand: "ಸಾವಿರ", lakh: "ಲಕ್ಷ", crore: "ಕೋಟಿ",
};

const MALAYALAM: NumberWords = {
  digits: ["പൂജ്യം", "ഒന്ന്", "രണ്ട്", "മൂന്ന്", "നാല്", "അഞ്ച്", "ആറ്", "ഏഴ്", "എട്ട്", "ഒമ്പത്"],
  units: ["പൂജ്യം", "ഒന്ന്", "രണ്ട്", "മൂന്ന്", "നാല്", "അഞ്ച്", "ആറ്", "ഏഴ്", "എട്ട്", "ഒമ്പത്", "പത്ത്", "പതിനൊന്ന്", "പന്ത്രണ്ട്", "പതിമൂന്ന്", "പതിനാല്", "പതിനഞ്ച്", "പതിനാറ്", "പതിനേഴ്", "പതിനെട്ട്", "പത്തൊമ്പത്"],
  tens: ["", "", "ഇരുപത്", "മുപ്പത്", "നാല്പത്", "അമ്പത്", "അറുപത്", "എഴുപത്", "എൺപത്", "തൊണ്ണൂറ്"],
  hundred: "നൂറ്", thousand: "ആയിരം", lakh: "ലക്ഷം", crore: "കോടി",
};

const PUNJABI: NumberWords = {
  digits: ["ਜ਼ੀਰੋ", "ਇੱਕ", "ਦੋ", "ਤਿੰਨ", "ਚਾਰ", "ਪੰਜ", "ਛੇ", "ਸੱਤ", "ਅੱਠ", "ਨੌਂ"],
  units: ["ਜ਼ੀਰੋ", "ਇੱਕ", "ਦੋ", "ਤਿੰਨ", "ਚਾਰ", "ਪੰਜ", "ਛੇ", "ਸੱਤ", "ਅੱਠ", "ਨੌਂ", "ਦਸ", "ਗਿਆਰਾਂ", "ਬਾਰਾਂ", "ਤੇਰਾਂ", "ਚੌਦਾਂ", "ਪੰਦਰਾਂ", "ਸੋਲਾਂ", "ਸਤਾਰਾਂ", "ਅਠਾਰਾਂ", "ਉੱਨੀ"],
  tens: ["", "", "ਵੀਹ", "ਤੀਹ", "ਚਾਲੀ", "ਪੰਜਾਹ", "ਸੱਠ", "ਸੱਤਰ", "ਅੱਸੀ", "ਨੱਬੇ"],
  hundred: "ਸੌ", thousand: "ਹਜ਼ਾਰ", lakh: "ਲੱਖ", crore: "ਕਰੋੜ",
};

const BENGALI: NumberWords = {
  digits: ["শূন্য", "এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়"],
  units: ["শূন্য", "এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়", "দশ", "এগারো", "বারো", "তেরো", "চোদ্দ", "পনেরো", "ষোল", "সতেরো", "আঠারো", "ঊনিশ"],
  tens: ["", "", "বিশ", "ত্রিশ", "চল্লিশ", "পঞ্চাশ", "ষাট", "সত্তর", "আশি", "নব্বই"],
  hundred: "একশ", thousand: "হাজার", lakh: "লাখ", crore: "কোটি",
};

const GUJARATI: NumberWords = {
  digits: ["શૂન્ય", "એક", "બે", "ત્રણ", "ચાર", "પાંચ", "છ", "સાત", "આઠ", "નવ"],
  units: ["શૂન્ય", "એક", "બે", "ત્રણ", "ચાર", "પાંચ", "છ", "સાત", "આઠ", "નવ", "દસ", "અગિયાર", "બાર", "તેર", "ચૌદ", "પંદર", "સોળ", "સત્તર", "અઢાર", "ઓગણીસ"],
  tens: ["", "", "વીસ", "ત્રીસ", "ચાલીસ", "પચાસ", "સાઠ", "સિત્તેર", "એંસી", "નેવું"],
  hundred: "સો", thousand: "હજાર", lakh: "લાખ", crore: "કરોડ",
};

export const NUMBER_WORDS: Record<NormalizerLocale, NumberWords> = {
  "en-IN": ENGLISH, "hi-en": ENGLISH, "hi-IN": HINDI, "mr-IN": MARATHI, "ta-IN": TAMIL,
  "te-IN": TELUGU, "kn-IN": KANNADA, "ml-IN": MALAYALAM, "pa-IN": PUNJABI,
  "bn-IN": BENGALI, "gu-IN": GUJARATI,
};

const CURRENCY_NOUN: Record<NormalizerLocale, { major: string; minor: string }> = {
  "en-IN": { major: "rupees", minor: "paise" }, "hi-en": { major: "rupees", minor: "paise" },
  "hi-IN": { major: "रुपये", minor: "पैसे" }, "mr-IN": { major: "रुपये", minor: "पैसे" },
  "ta-IN": { major: "ரூபாய்", minor: "பைசா" }, "te-IN": { major: "రూపాయలు", minor: "పైసలు" },
  "kn-IN": { major: "ರೂಪಾಯಿ", minor: "ಪೈಸೆ" }, "ml-IN": { major: "രൂപ", minor: "പൈസ" },
  "pa-IN": { major: "ਰੁਪਏ", minor: "ਪੈਸੇ" }, "bn-IN": { major: "টাকা", minor: "পয়সা" },
  "gu-IN": { major: "રૂપિયા", minor: "પૈસા" },
};

const PERCENT_WORD: Record<NormalizerLocale, string> = {
  "en-IN": "percent", "hi-en": "percent", "hi-IN": "प्रतिशत", "mr-IN": "टक्के",
  "ta-IN": "சதவீதம்", "te-IN": "శాతం", "kn-IN": "ಪ್ರತಿಶತ", "ml-IN": "ശതമാനം",
  "pa-IN": "ਪ੍ਰਤੀਸ਼ਤ", "bn-IN": "শতাংশ", "gu-IN": "ટકા",
};

/**
 * Spoken Indic quantity fractions. Each entry carries both readings because the
 * words are not pure multipliers:
 *   · सवा (sawa)  → "+ a quarter"  `सवा तीन` = 3.25   (delta, needs a base)
 *   · डेढ़ (dedh)  → "+ a half"     `डेढ़ क्विंटल` = 1.5, `तीन डेढ़`? never used
 *   · ढाई (dhai)  → absolute 2.5   `ढाई क्विंटल` = 2.5 (no base)
 *   · पौने (paune)→ "− a quarter"  `पौने तीन` = 2.75
 */
const COLLOQUIAL_FRACTIONS: { pattern: RegExp; hi: string; mr: string; delta: number; standalone: number | null }[] = [
  { pattern: /\bसवा\b/g, hi: "सवा", mr: "सव्वा", delta: 0.25, standalone: null },
  { pattern: /\bडेढ़\b/g, hi: "डेढ़", mr: "दीड", delta: 0.5, standalone: 1.5 },
  { pattern: /\bढाई\b/g, hi: "ढाई", mr: "अडीच", delta: 0.5, standalone: 2.5 },
  { pattern: /\bपौने\b/g, hi: "पौने", mr: "पाऊण", delta: -0.25, standalone: null },
  { pattern: /\bsawa\b/gi, hi: "सवा", mr: "सव्वा", delta: 0.25, standalone: null },
  { pattern: /\bdedh\b/gi, hi: "डेढ़", mr: "दीड", delta: 0.5, standalone: 1.5 },
  { pattern: /\bdhai\b/gi, hi: "ढाई", mr: "अडीच", delta: 0.5, standalone: 2.5 },
  { pattern: /\bpaune\b/gi, hi: "पौने", mr: "पाऊण", delta: -0.25, standalone: null },
];

/** Does this token spell a colloquial fraction, and is it absolute or a delta? */
function fractionForWord(word: string) {
  const clean = word.replace(/[^\u0900-\u097F\w]/g, "").toLowerCase();
  return COLLOQUIAL_FRACTIONS.find((fraction) => fraction.hi === clean || fraction.mr === clean || /^(sawa|dedh|dhai|paune)$/.test(clean)) ?? null;
}

/** 0..99 in the target language; Dravidian tens join with a space (documented approximation). */
export function numberToWordsUnder100(value: number, locale: NormalizerLocale): string {
  const words = NUMBER_WORDS[locale] ?? HINDI;
  if (value < 20) return words.units[value];
  const ten = Math.floor(value / 10);
  const unit = value % 10;
  if (!unit) return words.tens[ten];
  return words.join ? words.join(words.tens[ten], words.units[unit]) : `${words.tens[ten]} ${words.units[unit]}`;
}

/** Indian numbering system: crore / lakh / thousand / hundred, all the way to 99 crore. */
export function numberToWordsIndian(value: number, locale: NormalizerLocale): string {
  const words = NUMBER_WORDS[locale] ?? HINDI;
  const n = Math.trunc(Math.abs(value));
  const sign = value < 0 ? (locale.startsWith("en") || locale === "hi-en" ? "negative " : "minus ") : "";
  if (n === 0) return `${sign}${words.units[0]}`;
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (crore) parts.push(`${crore >= 100 ? numberToWordsIndian(crore, locale) : numberToWordsUnder100(crore, locale)} ${words.crore}`);
  if (lakh) parts.push(`${numberToWordsUnder100(lakh, locale)} ${words.lakh}`);
  if (thousand) parts.push(`${numberToWordsUnder100(thousand, locale)} ${words.thousand}`);
  if (hundred) parts.push(`${words.units[hundred]} ${words.hundred}`);
  if (rest) parts.push(numberToWordsUnder100(rest, locale));
  return `${sign}${parts.join(" ")}`;
}

const DIGIT_JOIN = " ";

/** Spell a digit run digit-by-digit (IDs, plates, phone numbers). Never returns raw digits. */
export function spellDigits(digits: string, locale: NormalizerLocale): string {
  const words = NUMBER_WORDS[locale] ?? HINDI;
  return digits.split("").map((char) => words.digits[Number(char)] ?? char).join(DIGIT_JOIN);
}

const LETTER_NAMES_DEV = "ए बी सी डी ई एफ जी एच आई जे के एल एम एन ओ पी क्यू आर एस टी यू वी डब्ल्यू एक्स वाई जेड".split(" ");

function spellLatin(token: string, locale: NormalizerLocale): string {
  const devanagari = locale === "hi-IN" || locale === "mr-IN";
  return token.split("").map((char) => {
    if (/[0-9]/.test(char)) return spellDigits(char, locale);
    if (/[a-z]/i.test(char)) {
      const index = char.toUpperCase().charCodeAt(0) - 65;
      return devanagari ? LETTER_NAMES_DEV[index] ?? char : char.toUpperCase();
    }
    return char;
  }).join(DIGIT_JOIN);
}

/** Recognise + expand Indian structured identifiers before generic number handling. */
export function normalizeIdentifiers(text: string, locale: NormalizerLocale): string {
  let output = text;
  // GSTIN: 22AAAAA0000A1Z5 (15 chars)
  output = output.replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z]\d\b/g, (value) => spellLatin(value, locale));
  // IFSC: AAAA0XXXXXX (11 chars)
  output = output.replace(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, (value) => spellLatin(value, locale));
  // UTR: 12-digit bank reference
  output = output.replace(/\bUTR[:\s#-]*(\d{12})\b/gi, (_, digits: string) => `U T R ${spellDigits(digits, locale)}`);
  // Aadhaar: 12-digit grouped 4-4-4
  output = output.replace(/\b(\d{4})\s?(\d{4})\s?(\d{4})\b/g, (_, a: string, b: string, c: string) => `${spellDigits(a, locale)}, ${spellDigits(b, locale)}, ${spellDigits(c, locale)}`);
  // Vehicle registration: MH 15 AB 4321 / MH-15-AB-4321
  output = output.replace(/\b([A-Z]{2})[\s-]?(\d{1,2})[\s-]?([A-Z]{1,3})[\s-]?(\d{4})\b/g,
    (_, state: string, rto: string, series: string, number: string) =>
      `${spellLatin(state, locale)}, ${spellDigits(rto, locale)}, ${spellLatin(series, locale)}, ${spellDigits(number, locale)}`);
  // PIN code with a PIN keyword
  output = output.replace(/\bPIN[:\s-]*(\d{6})\b/gi, (_, digits: string) => `PIN ${spellDigits(digits, locale)}`);
  return output;
}

export interface NormalizationResult {
  text: string;
  changed: boolean;
  identifiers: number;
  currency: number;
  fractions: number;
}

const CURRENCY_AMOUNT = /(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?)/gi;

/** Expand `₹1,45,250` / `₹1,45,250.50` / `Rs 500` into spoken words (rupees + paise). */
function expandCurrency(text: string, locale: NormalizerLocale, counter: { value: number }): string {
  const noun = CURRENCY_NOUN[locale] ?? CURRENCY_NOUN["hi-IN"];
  return text.replace(CURRENCY_AMOUNT, (_, raw: string) => {
    counter.value += 1;
    const [whole, fractional] = raw.replace(/,/g, "").split(".");
    const rupees = Number(whole || "0");
    const paise = fractional ? Number(fractional.padEnd(2, "0")) : 0;
    const parts = [`${numberToWordsIndian(rupees, locale)} ${noun.major}`];
    if (paise) parts.push(`${numberToWordsUnder100(paise, locale)} ${noun.minor}`);
    return parts.join(" ");
  });
}

/** Convert `सवा तीन क्विंटल` -> "3.25 क्विंटल" numerically and keep a spoken prefix. */
export function normalizeFractions(text: string, locale: NormalizerLocale): { text: string; count: number } {
  let output = text;
  let count = 0;
  for (const fraction of COLLOQUIAL_FRACTIONS) {
    if (!fraction.pattern.test(output)) { fraction.pattern.lastIndex = 0; continue; }
    fraction.pattern.lastIndex = 0;
    output = output.replace(fraction.pattern, (match) => {
      count += 1;
      const spoken = locale === "mr-IN" ? fraction.mr : locale === "hi-IN" ? fraction.hi : match;
      return spoken === match ? match : `${spoken} (${fraction.standalone ?? fraction.delta})`;
    });
  }
  return { text: output, count };
}

export function normalizeIndicText(input: string, locale: NormalizerLocale): NormalizationResult {
  const original = input;
  const counters = { currency: 0, fractions: 0 };
  let text = input.replace(/\s+/g, " ").trim();

  const identifierCount = (normalizeIdentifiers(text, locale).match(/\s/g) ?? []).length > 0 ? 1 : 0;
  text = normalizeIdentifiers(text, locale);

  text = expandCurrency(text, locale, { value: 0 });
  if (text !== input) counters.currency = 1;

  const fractions = normalizeFractions(text, locale);
  text = fractions.text;
  counters.fractions = fractions.count;

  // Percentages after currency so `₹500.50` paise are not mistaken for percent.
  text = text.replace(/(\d+(?:\.\d+)?)\s?%/g, (_, raw: string) => {
    const [whole, fractional] = raw.split(".");
    const spoken = fractional
      ? `${numberToWordsIndian(Number(whole), locale)} ${decimalWord(locale)} ${spellDigits(fractional, locale)}`
      : numberToWordsIndian(Number(whole), locale);
    return `${spoken} ${PERCENT_WORD[locale] ?? PERCENT_WORD["hi-IN"]}`;
  });

  // Dates DD/MM/YYYY -> spoken day, month, year (year read as digit pairs).
  text = text.replace(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/g, (_, day: string, month: string, year: string) => {
    const months = locale === "hi-IN" || locale === "mr-IN"
      ? ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"]
      : ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthWord = months[Math.max(0, Math.min(11, Number(month) - 1))];
    return `${numberToWordsIndian(Number(day), locale)} ${monthWord} ${spellDigits(year, locale)}`;
  });

  // Remaining bare integers (length >= 4 to avoid quantities like "5 kg" becoming noisy).
  text = text.replace(/\b(\d{4,})\b/g, (match) => numberToWordsIndian(Number(match), locale));

  return {
    text,
    changed: text !== original,
    identifiers: identifierCount,
    currency: counters.currency,
    fractions: counters.fractions,
  };
}

function decimalWord(locale: NormalizerLocale): string {
  if (locale === "hi-IN" || locale === "mr-IN") return "दशमलव";
  return "point";
}

const QUANTITY_WORDS: Record<string, number> = {
  आधा: 0.5, एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5, छह: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  बारह: 12, पंद्रह: 15, बीस: 20, पच्चीस: 25, तीस: 30, चालीस: 40, पचास: 50, साठ: 60, सौ: 100,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, twentyfive: 25, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100,
};

/**
 * Numeric side of the ledger: colloquial fractions -> exact quantity.
 * `सवा तीन` -> 3.25, `ढाई` -> 2.5, `3.5 क्विंटल` -> 3.5. Understands both digits
 * and spoken number words, because Prisma returns whichever the speaker used.
 */
export function parseQuantity(text: string): number | null {
  const tokens = text.split(/[\s,]+/);
  // Keep interior decimals ("3.5") but strip currency, thousands separators and
  // trailing punctuation ("₹2,450" -> "2450").
  const clean = (token: string) => token.replace(/[,₹%]/g, "").replace(/[^\u0900-\u097F\w.]/g, "").replace(/\.$/, "");
  const isUnit = (token: string) => /^(क्विंटल|quintal|qtl|किलो|kg|पैकेट|packet|पैक|liter|लीटर)$/i.test(clean(token));

  // 1 · count word (digit or spoken) immediately followed by a unit.
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isUnit(tokens[index + 1] ?? "")) continue;
    const token = clean(tokens[index]);
    const numeric = /^\d+(?:\.\d+)?$/.test(token) ? Number(token) : QUANTITY_WORDS[token.toLowerCase()];
    if (numeric === undefined) continue;
    const fraction = fractionForWord(tokens[index - 1] ?? "");
    return fraction ? Number((numeric + fraction.delta).toFixed(2)) : numeric;
  }

  // 2 · a bare absolute fraction ("ढाई क्विंटल", or just "ढाई") needs no count word.
  for (const token of tokens) {
    const fraction = fractionForWord(token);
    if (fraction && fraction.standalone !== null) return fraction.standalone;
  }

  // 3 · no unit at all: first digit wins, adjusted by any verbal fraction present.
  const decimal = text.match(/\d+(?:\.\d+)?/);
  if (!decimal) return null;
  const base = Number(decimal[0]);
  const fraction = COLLOQUIAL_FRACTIONS.find((item) => text.includes(item.hi) || text.includes(item.mr));
  return fraction ? Number((base + fraction.delta).toFixed(2)) : base;
}

/** Strip tags for timbre-v2.5 / vachana-vc-v1; keep only catalog tags for timbre-v3.0. */
export function sanitizeAudioTags(text: string, model: string, allowed: readonly string[]): { text: string; removed: string[]; kept: string[] } {
  const removed: string[] = [];
  const kept: string[] = [];
  const output = text.replace(/<([^>]+)>/g, (_match, raw: string) => {
    // Gnani audio tags are case-sensitive: `<whispers>` is valid, `<Whispers>` is not.
    const tag = raw.trim();
    if (model === "timbre-v3.0" && allowed.includes(tag)) { kept.push(tag); return `<${tag}>`; }
    removed.push(tag);
    return "";
  }).replace(/\s{2,}/g, " ").trim();
  return { text: output, removed, kept };
}
