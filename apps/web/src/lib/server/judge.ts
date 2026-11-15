/**
 * Contract + judge extraction.
 *
 * `deterministicJudge()` is a rules engine over the normalised transcript — it is
 * the source of truth for the ledger structure and works with zero API keys.
 * `groqJudge()` refines the same JSON with llama-3.3-70b-versatile when a key is
 * present, but its output is validated and merged field-by-field; the judge can
 * never invent a total that the deterministic parse disagrees with by >2%.
 */
import { parseQuantity } from "@/lib/gnani/normalizer";
import type { WorkflowDomain } from "./catalog";

export interface ContractDraft {
  commodity?: string;
  quantity_quintal?: number;
  quantity_kg?: number;
  rate_per_quintal?: number;
  total_inr?: number;
  credit_days?: number;
  fair_price_warning?: boolean;
  items?: { name: string; qty: number; rate: number }[];
  gstin_present?: boolean;
  clinical_triage_level?: "routine" | "watch" | "urgent" | "emergency";
  vitals?: Record<string, number>;
  incident?: string;
  location?: string;
  anonymous_cloak?: boolean;
  pstn_mulaw?: boolean;
  confidence: number;
  engine: "deterministic" | "groq" | "groq+deterministic";
  notes: string[];
}

const COMMODITIES = [
  "लहसुन", "garlic", "कांदा", "onion", "प्याज़", "सोना मसूरी", "sona masoori", "basmati", "गेहूँ", "wheat",
  "सोयाबीन", "soybean", "कपास", "cotton", "टमाटर", "tomato", "आलू", "potato", "चना", "gram", "मक्का", "maize",
];

const FRACTION_WORDS: [RegExp, number][] = [
  [/सवा|sawa/i, 0.25], [/डेढ़|dedh/i, 0.5], [/ढाई|dhai/i, 0.5], [/पौने|paune/i, -0.25],
];

/** Strip the human-readable fraction parenthetical the normaliser adds for TTS. */
function stripSpokenAnnotations(transcript: string): string {
  return transcript.replace(/\s*\((\d+(?:\.\d+)?)\)/g, " $1 ");
}

export function deterministicJudge(domain: WorkflowDomain, transcript: string, referenceFairPrice?: number): ContractDraft {
  const notes: string[] = [];
  const contract: ContractDraft = { confidence: 0.72, engine: "deterministic", notes };

  if (domain === "mandi") {
    const spoken = stripSpokenAnnotations(transcript);
    const commodity = COMMODITIES.find((item) => spoken.toLowerCase().includes(item.toLowerCase()));
    if (commodity) contract.commodity = commodity;
    const quantity = parseQuantity(spoken) ?? undefined;
    if (quantity !== undefined) contract.quantity_quintal = quantity;

    const rupees = spoken.replace(/₹/g, " ").match(/(\d[\d,]{2,})/g)?.map((value) => Number(value.replace(/,/g, ""))) ?? [];
    const rate = rupees.find((value) => value >= 500) ?? undefined;
    if (rate) contract.rate_per_quintal = rate;
    if (contract.quantity_quintal && contract.rate_per_quintal) {
      contract.total_inr = Math.round(contract.quantity_quintal * contract.rate_per_quintal);
      notes.push("total = quantity × rate (per quintal)");
    }
    const days = spoken.match(/(\d{1,3})\s*(?:दिन|days?|din)/i);
    if (days) contract.credit_days = Number(days[1]);
    if (referenceFairPrice !== undefined && contract.rate_per_quintal) {
      const delta = (contract.rate_per_quintal - referenceFairPrice) / referenceFairPrice;
      contract.fair_price_warning = delta < -0.18;
      notes.push(`rate is ${(delta * 100).toFixed(1)}% vs reference ${referenceFairPrice}`);
    }
    contract.confidence = commodity && quantity && rate ? 0.9 : commodity ? 0.78 : 0.6;
  }

  if (domain === "kirana") {
    const items: { name: string; qty: number; rate: number }[] = [];
    const catalogue: [RegExp, string, number][] = [
      [/पारले|parle/i, "Parle-G 250g", 30],
      [/फॉर्च्यून|fortune/i, "Fortune Kachi Ghani 1L", 185],
      [/आटा|atta/i, "Atta 5kg", 320],
      [/मैगी|maggi/i, "Maggi 12-pack", 168],
      [/टाटा सांप्रन|tata sampann/i, "Tata Sampann dal 1kg", 165],
      [/चावल|rice/i, "Rice bag 10kg", 520],
      [/दूध|milk/i, "Amul Taaza 500ml", 28],
    ];
    for (const [pattern, name, rate] of catalogue) {
      if (!pattern.test(transcript)) continue;
      // Group the alternation: `${pattern.source}` is `पारले|parle`, and inlining it
      // un-grouped makes the last branch match on its own and lose the quantity.
      const quantity = transcript.match(new RegExp(`(\\d+|एक|दो|तीन|चार|पाँच|छह)\\s*(?:पैकेट|packet|किलो|kg|पैक|liter|लीटर)?[^,.।|]{0,14}(?:${pattern.source})`, "i"));
      items.push({ name, qty: wordToNumber(quantity?.[1] ?? "1"), rate });
    }
    if (items.length) contract.items = items;
    const total = transcript.replace(/,/g, "").match(/(\d{3,6})\s*(?:रुपये|rupees|rupaye)/i);
    if (total) contract.total_inr = Number(total[1]);
    else if (items.length) contract.total_inr = items.reduce((sum, item) => sum + item.qty * item.rate, 0);
    const days = transcript.match(/(\d{1,3})\s*(?:दिन|days?|din)/i);
    contract.credit_days = days ? Number(days[1]) : 30;
    contract.gstin_present = /[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9][A-Z][0-9]/.test(transcript);
    contract.confidence = items.length ? 0.86 : 0.58;
    notes.push(`${items.length} catalogue item(s) matched`);
  }

  if (domain === "asha") {
    const vitals: Record<string, number> = {};
    const spo2 = transcript.match(/(?:spo2|oxygen|ऑक्सीजन|నబ్బై|నూరు)[^\d]{0,10}(\d{2,3})/i);
    if (spo2) vitals.spo2 = Number(spo2[1]);
    const pulse = transcript.match(/(?:pulse|पल्स)[^\d]{0,10}(\d{2,3})/i);
    if (pulse) vitals.pulse = Number(pulse[1]);
    const temp = transcript.match(/(\d{2}(?:\.\d)?)\s*(?:डिग्री|degree|°)/i);
    if (temp) vitals.temperature_c = Number(temp[1]);
    contract.vitals = vitals;
    const level = vitals.spo2 !== undefined && vitals.spo2 < 90 ? "emergency"
      : (vitals.pulse ?? 0) > 110 || (vitals.spo2 ?? 100) < 94 ? "urgent"
      : (vitals.pulse ?? 0) > 100 ? "watch" : "routine";
    contract.clinical_triage_level = level;
    contract.confidence = Object.keys(vitals).length ? 0.88 : 0.55;
    notes.push(`triage ${level} from ${Object.keys(vitals).length} vitals`);
  }

  if (domain === "highway_112") {
    const incident = /tyre|टायर/i.test(transcript) ? "tyre_burst"
      : /accident|एक्सीडेंट|haddsa/i.test(transcript) ? "collision"
      : /fire|आग/i.test(transcript) ? "fire"
      : /wage|मज़दूरी|salary/i.test(transcript) ? "wage_grievance"
      : /ration|राशन|pds/i.test(transcript) ? "entitlement_grievance" : "unclassified";
    contract.incident = incident;
    const location = transcript.match(/NH[-\s]?\d{1,3}[^,.]{0,40}/i)?.[0];
    if (location) contract.location = location.trim();
    contract.anonymous_cloak = /गुमनाम|anonymous|gumnaam/i.test(transcript);
    contract.confidence = incident !== "unclassified" ? 0.83 : 0.5;
    notes.push(`incident classified as ${incident}`);
  }

  return contract;
}

function wordToNumber(value: string): number {
  const words: Record<string, number> = { एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, छह: 6, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  if (words[value.toLowerCase()]) return words[value.toLowerCase()];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 1;
}

/**
 * Optional Groq refinement. Two keys = two roles:
 *  GROQ_API_KEY_1 (llama-3.1-8b-instant)  → speculative normalisation of the transcript
 *  GROQ_API_KEY_2 (llama-3.3-70b-versatile) → structured contract JSON
 * Response is merged conservatively; any parse failure keeps the deterministic draft.
 */
export async function groqJudge(domain: WorkflowDomain, transcript: string, draft: ContractDraft): Promise<ContractDraft> {
  const key = process.env.GROQ_API_KEY_2?.trim() ?? process.env.GROQ_API_KEY_1?.trim();
  if (!key) return draft;
  const systemPrompt = `You extract structured trade/clinical facts for the "${domain}" workflow of an Indic voice ledger. Reply with JSON only, keys allowed: commodity, quantity_quintal, rate_per_quintal, total_inr, credit_days, items[{name,qty,rate}], clinical_triage_level, incident, location. Never invent numbers that are absent from the transcript.`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.1,
        max_tokens: 512,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcript.slice(0, 2_000) },
        ],
      }),
    });
    clearTimeout(timer);
    if (!response.ok) return draft;
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return draft;
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const merged: ContractDraft = { ...draft, engine: "groq+deterministic", confidence: Math.min(0.97, draft.confidence + 0.05), notes: [...draft.notes, "groq judge merged"] };
    for (const field of ["commodity", "rate_per_quintal", "credit_days", "incident", "location", "clinical_triage_level"] as const) {
      if (parsed[field] !== undefined && parsed[field] !== null) (merged as unknown as Record<string, unknown>)[field] = parsed[field];
    }
    if (typeof parsed.total_inr === "number" && draft.total_inr && Math.abs(parsed.total_inr - draft.total_inr) / draft.total_inr <= 0.02) merged.total_inr = parsed.total_inr;
    if (Array.isArray(parsed.items) && !draft.items?.length) merged.items = parsed.items as ContractDraft["items"];
    return merged;
  } catch {
    return draft;
  }
}
