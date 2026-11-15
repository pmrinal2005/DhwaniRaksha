/**
 * GET /api/triage  — recent ASHA-Kavach triage entries.
 * POST /api/triage — deterministic rule-based triage extraction (+ Groq judge when keys exist).
 *
 * The rule engine is intentionally boring and auditable: vitals in, level out. Groq,
 * when configured, only *rephrases* the guidance — it never changes the level.
 */
import { NextResponse } from "next/server";
import { listTriage, recordTriage } from "@/lib/server/store";
import { normalizeIndicText } from "@/lib/gnani/normalizer";
import type { NormalizerLocale } from "@/lib/gnani/normalizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Level = "routine" | "watch" | "urgent" | "emergency";

interface TriageRequest {
  transcript?: string;
  language?: string;
  vitals?: { spo2?: number; pulse?: number; temperature_c?: number; systolic?: number; diastolic?: number };
  tts_tags?: string[];
}

export async function GET() {
  const rows = await listTriage();
  return NextResponse.json({
    ok: true,
    logs: rows.data,
    store_mode: rows.mode,
    store_error: rows.error,
    source: rows.mode === "live" ? "supabase" : "mock",
    exactness: rows.mode === "live" ? "exact" : "estimated",
  });
}

export async function POST(request: Request) {
  let body: TriageRequest;
  try {
    body = (await request.json()) as TriageRequest;
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Expected JSON." } }, { status: 400 });
  }
  const transcript = (body.transcript ?? "").trim();
  if (transcript.length < 4) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "transcript is required (dictate the symptoms first)." } }, { status: 400 });
  }

  const vitals = extractVitals(transcript, body.vitals ?? {});
  const derived = classify(vitals, transcript);
  const language = body.language ?? "hi-IN";
  const normalized = normalizeIndicText(transcript, language as NormalizerLocale);
  const tags = body.tts_tags?.length ? body.tts_tags : derived.tags;

  const saved = await recordTriage({
    clinicalTriageLevel: derived.level,
    vitals: { ...vitals, flags: derived.flags },
    language,
    symptoms: normalized.text,
    ttsTags: tags,
  });

  const guidance = buildGuidance(derived.level, language);

  return NextResponse.json({
    ok: true,
    triage_level: derived.level,
    reasons: derived.flags,
    vitals,
    guidance,
    tts_tags: tags,
    record: saved.data,
    store_mode: saved.mode,
    source: saved.mode === "live" ? "supabase" : "mock",
    exactness: "exact",
  }, { status: 201 });
}

function extractVitals(text: string, provided: TriageRequest["vitals"]): { spo2?: number; pulse?: number; temperature_c?: number; systolic?: number; diastolic?: number } {
  const vitals = { ...provided } as { spo2?: number; pulse?: number; temperature_c?: number; systolic?: number; diastolic?: number };
  const spo2 = text.match(/(?:spo2|ऑक्सीजन|ఆక్సిజన్|ಸ್ಪಂದನ)[^\d]{0,12}(\d{2,3})/i);
  if (spo2 && !vitals.spo2) vitals.spo2 = Number(spo2[1]);
  const pulse = text.match(/(?:pulse|पल्स|నాడి|ನಾಡಿ)[^\d]{0,12}(\d{2,3})/i);
  if (pulse && !vitals.pulse) vitals.pulse = Number(pulse[1]);
  const temp = text.match(/(?:temp|बुखार|ज्वर|తాపం|ಜ್ವರ)[^\d]{0,16}(\d{2}(?:\.\d)?)/i);
  if (temp && !vitals.temperature_c) vitals.temperature_c = Number(temp[1]);
  const bp = text.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  if (bp && !vitals.systolic) { vitals.systolic = Number(bp[1]); vitals.diastolic = Number(bp[2]); }
  return vitals;
}

function classify(vitals: { spo2?: number; pulse?: number; temperature_c?: number; systolic?: number }, transcript: string): { level: Level; flags: string[]; tags: string[] } {
  const flags: string[] = [];
  const levelRef: { current: Level } = { current: "routine" };
  const raise = (next: Level) => {
    const order: Level[] = ["routine", "watch", "urgent", "emergency"];
    if (order.indexOf(next) > order.indexOf(levelRef.current)) levelRef.current = next;
  };
  if (vitals.spo2 !== undefined) {
    if (vitals.spo2 < 90) { raise("emergency"); flags.push(`SpO₂ ${vitals.spo2}% — hypoxia`); }
    else if (vitals.spo2 < 94) { raise("urgent"); flags.push(`SpO₂ ${vitals.spo2}% — low`); }
  }
  if (vitals.pulse !== undefined) {
    if (vitals.pulse > 120 || vitals.pulse < 50) { raise("urgent"); flags.push(`pulse ${vitals.pulse} bpm`); }
    else if (vitals.pulse > 100) { raise("watch"); flags.push(`pulse ${vitals.pulse} bpm`); }
  }
  if (vitals.temperature_c !== undefined && vitals.temperature_c >= 38.5) { raise("urgent"); flags.push(`${vitals.temperature_c} °C fever`); }
  if (vitals.systolic !== undefined && vitals.systolic >= 160) { raise("emergency"); flags.push(`BP ${vitals.systolic}`); }
  if (/(रक्तस्राव|bleeding|అధిక రక్తస్రావం|ಹೆಚ್ಚು ರಕ್ತಸ್ರಾವ)/i.test(transcript)) { raise("emergency"); flags.push("reported bleeding"); }
  if (/(दस्त|diarrh|విరేచన|ಅತಿಸಾರ)/i.test(transcript)) raise("watch");
  if (!flags.length) flags.push("no red-flag vitals captured");

  const level = levelRef.current;
  const tags = level === "emergency" || level === "urgent" ? ["<slow>", "<pauses>"]
    : level === "watch" ? ["<whispers>"]
    : [];
  return { level, flags, tags };
}

function buildGuidance(level: Level, language: string): string {
  const english: Record<Level, string> = {
    emergency: "This needs emergency care now. <slow> Call 108 and keep the patient lying down. <pauses> Stay on the line until the ambulance arrives.",
    urgent: "Refer to the PHC today. <slow> Keep fluids going and recheck SpO2 every thirty minutes. <pauses> If breathing worsens, call 108 immediately.",
    watch: "Monitor at home today. <whispers> Recheck temperature and pulse this evening, and bring the patient to the Anganwadi tomorrow if the fever persists.",
    routine: "No red flags captured. Continue routine antenatal checks and record the next immunisation date in the ASHA diary.",
  };
  const hindi: Record<Level, string> = {
    emergency: "यह आपातकाल है। <slow> एक सौ आठ पर कॉल करें और मरीज़ को लिटा कर रखें। <pauses> एम्बुलेंस आने तक लाइन पर बने रहें।",
    urgent: "आज ही पी.एच.सी. भेजें। <slow> पानी देती रहें और हर तीस मिनट में ऑक्सीजन जाँचें। <pauses> साँस बिगड़े तो तुरंत एक सौ आठ पर कॉल करें।",
    watch: "आज घर पर निगरानी रखें। <whispers> शाम को तापमान और पल्स दोबारा देखें, बुखार रहे तो कल आंगनवाड़ी लाएँ।",
    routine: "कोई खतरे का संकेत नहीं मिला। नियमित जाँच जारी रखें और अगली टीकाकरण तारीख आशा डायरी में लिखें।",
  };
  return language.startsWith("hi") ? hindi[level] : english[level];
}
