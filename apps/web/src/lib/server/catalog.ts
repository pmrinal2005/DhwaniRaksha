/** Static domain catalog: the four Bharat workflows, their RAG keyterm clusters and demo casts. */

export const GOAL = Object.freeze({
  credits: 3000,
  hardStopFloor: 150,          // never let demo runs eat the last 150 credits
  verifiedThreshold: 0.86,
  noisyThreshold: 0.74,
});

export type WorkflowDomain = "mandi" | "kirana" | "asha" | "highway_112";

export interface WorkflowCluster {
  name: string;
  keyterms: string[];
}

export interface WorkflowMeta {
  domain: WorkflowDomain;
  label: string;
  native: string;
  kicker: string;
  scenario: string;
  accent: "ember" | "violet" | "emerald" | "amber";
  glyph: "store" | "shopping-bag" | "heart-pulse" | "hard-hat";
  topic: string;
  parties: {
    a: { name: string; role: string; language: string; locale: string };
    b: { name: string; role: string; language: string; locale: string };
  };
  clusters: WorkflowCluster[];
  sampleUtterance: string;
  sampleTranslation: string;
}

export const WORKFLOWS: Record<WorkflowDomain, WorkflowMeta> = {
  mandi: {
    domain: "mandi",
    label: "Mandi-Mudra",
    native: "मंडी-मुद्रा",
    kicker: "APMC cross-dialect brokerage",
    scenario: "A Nashik garlic farmer and a Madurai wholesaler negotiate a quintal rate in their own dialects and mint a dual-voiceprint Boli-Patra.",
    accent: "ember",
    glyph: "store",
    topic: "Live APMC mandi auction between a Marathi-speaking farmer and a Tamil-speaking interstate trader. Capture quintal quantity, per-quintal rate in rupees, hamali and katai charges, credit days, and e-NAM reference bands. Prefer trade vocabulary: bhav, katai, hamali, tulai, aarhatiya.",
    parties: {
      a: { name: "Ramesh Patil", role: "farmer", language: "mr-IN", locale: "mr-IN" },
      b: { name: "Selvam Traders", role: "trader", language: "ta-IN", locale: "ta-IN" },
    },
    clusters: [
      { name: "Lasalgaon red garlic", keyterms: ["लहसुन", "Lasalgaon Red", "Nashik Gavran", "क्विंटल", "भाव", "आढत", "हमाली", "कटाई", "तुलाई", "e-NAM", "G-9 garlic", "शेती बाजार"] },
      { name: "Onion grade ladder", keyterms: ["कांदा", "Sona Masoori rice", "Pusa Basmati 1121", "Basmati rate", "ग्रेड", "मंडी आवक", "Mandi arrival", "Modal rate", "शेल्फ लाइफ", "Cold storage"] },
      { name: "Trade finance", keyterms: ["उधार", "Boli khata", "आढतिया", "पेमेंट शेड्यूल", "Bardana", "Weighbridge", "Tolai slip", "Gate pass", "बामी", "हिसाब"] },
      { name: "Weather & transport", keyterms: ["बारिश", "बरसात", "Truck loading", "ट्रक भाड़ा", "Diesel rate", "मंडी टोल", "Tarpaulin", "पल्ला", "Loading labour", "छप्पर"] },
    ],
    sampleUtterance: "सवा तीन क्विंटल लहसुन, भाव एक लाख छियालीस हज़ार रुपये क्विंटल, चालीस दिन उधार — सौदा पक्का?",
    sampleTranslation: "Three and a quarter quintal of garlic at one lakh forty six thousand rupees per quintal, forty days credit — deal locked?",
  },
  kirana: {
    domain: "kirana",
    label: "Kirana-Khata",
    native: "किराना-खाता",
    kicker: "Hinglish / Tanglish voice POS",
    scenario: "Hands-free kirana billing in code-mixed speech: build a GST invoice, verify the customer's 768-d voiceprint, then log udhaar against their khata.",
    accent: "violet",
    glyph: "shopping-bag",
    topic: "Hinglish kirana point-of-sale session. The shopkeeper dictates items and quantities in code-mixed Hindi-English; the customer confirms the total and asks for udhaar. Extract item names, quantities, rates, GSTIN if present, UPI/UTR references and credit days.",
    parties: {
      a: { name: "Kirana Meena", role: "kirana", language: "hi-IN", locale: "hi-IN" },
      b: { name: "Customer Ashok", role: "citizen", language: "hi-IN", locale: "hi-IN" },
    },
    clusters: [
      { name: "FMCG basket", keyterms: ["पारले जी", "Parle-G", "फॉर्च्यून कच्ची घानी", "Fortune Kachi Ghani", "टाटा सांप्रन", "Tata Sampann", "मैगी", "Maggi", "आटा", "Atta", "चावल", "Rice bag"] },
      { name: "Khata & credit", keyterms: ["उधार", "खाता", "पर्चा", "बाकी", "Khata book", "सेटलमेंट", "Settlement", "एडवांस", "Advance", "Balance carry forward"] },
      { name: "Payments", keyterms: ["UPI", "GSTIN", "UTR", "IFSC", "QR पेमेंट", "Cash count", "खुल्ले पैसे", "Change due", "Split payment"] },
      { name: "Billing", keyterms: ["बिल", "GST invoice", "CGST", "SGST", "होलसेल रेट", "MRP", "डिस्काउंट", "Discount scheme", "कैश मेमो", "Kaccha bill"] },
    ],
    sampleUtterance: "दो पैकेट पारले जी, एक फॉर्च्यून कच्ची घानी तेल, पाँच किलो आटा — अठारह सौ पैंतालीस रुपये, तीस दिन उधार खाते में डाल दो।",
    sampleTranslation: "Two packets of Parle-G, one Fortune Kachi Ghani oil, five kilos of atta — one thousand eight hundred forty five rupees, put it on thirty day credit.",
  },
  asha: {
    domain: "asha",
    label: "ASHA-Kavach",
    native: "आशा-कवच",
    kicker: "Maternal triage with expressive TTS",
    scenario: "A rural ASHA worker dictates symptoms and vitals in her own dialect; the ledger assigns a triage level and reads calm, tagged guidance back.",
    accent: "emerald",
    glyph: "heart-pulse",
    topic: "Rural maternal and child health triage dictated by an ASHA worker. Capture symptoms, SpO2, pulse, temperature, pregnancy status, immunisation schedule and referral advice. Prefer clinical terms in the caller's language.",
    parties: {
      a: { name: "ASHA Sunita", role: "asha", language: "te-IN", locale: "te-IN" },
      b: { name: "Patient Lakshmi", role: "citizen", language: "hi-IN", locale: "hi-IN" },
    },
    clusters: [
      { name: "Maternal red flags", keyterms: ["गर्भवती", "Garbhavati", "रक्तस्राव", "Bleeding", "उच्च रक्तचाप", "Eclampsia", "भ्रूण हलचल", "Foetal movement", "Preeclampsia", "मासिक धर्म"] },
      { name: "Vitals", keyterms: ["SpO2", "बीपी", "BP", "पल्स", "Pulse", "तापमान", "Temperature", "श्वास दर", "Respiratory rate", "Weight gain"] },
      { name: "Medicines", keyterms: ["ORS", "पैरासिटामोल", "Paracetamol", "Iron Folic Acid", "IFA tablets", "कैल्शियम", "Zinc", "प्रोटीन पाउडर", "Amoxicillin"] },
      { name: "Referral network", keyterms: ["PHC", "आंगनवाड़ी", "Anganwadi", "Janani Suraksha", "जननी सुरक्षा योजना", "108 एम्बुलेंस", "ASHA diary", "टीकाकरण", "Immunisation", "Vaccine cold chain"] },
    ],
    sampleUtterance: "गर्भवती महिला को दो दिन से तेज़ बुखार है, SpO2 नब्बे, पल्स एक सौ दस — PHC भेजना पड़ेगा।",
    sampleTranslation: "The pregnant woman has had high fever for two days, SpO2 ninety, pulse one hundred ten — she must be referred to the PHC.",
  },
  highway_112: {
    domain: "highway_112",
    label: "Shramik-Setu",
    native: "श्रमिक-सेतु",
    kicker: "112 emergency + whistleblower cloak",
    scenario: "A trucker calls in a tyre burst at NH-48, or a worker files an anonymous wage grievance. The Householder cloak keeps the voice unlinkable while testimony stays verifiable.",
    accent: "amber",
    glyph: "hard-hat",
    topic: "Highway emergency or citizen grievance call on the 112 network. Classify incident type, location cues (NH numbers, toll plazas, kilometre stones), injury status; for grievances capture scheme names (PDS, BPL, MGNREGA) and escalation authority.",
    parties: {
      a: { name: "Highway 112 Caller", role: "citizen", language: "en-IN", locale: "en-IN" },
      b: { name: "112 Control Room", role: "citizen", language: "hi-IN", locale: "hi-IN" },
    },
    clusters: [
      { name: "Incident types", keyterms: ["Tyre Burst", "NH-48", "Manesar toll", "एक्सीडेंट", "Accident", "Fire", "Medical emergency", "Pile-up", "Fog", "Black spot"] },
      { name: "Highway logistics", keyterms: ["Fastag", "Toll plaza", "Weighbridge", "Overload", "ट्रक यूनियन", "Dhaba", "Kilometre stone", "Service lane", "टोल रसीद"] },
      { name: "Wage grievance", keyterms: ["मज़दूरी", "Wage theft", "MGNREGA", "Job card", "ठेकेदार", "Contractor", "Labour chowk", "मुंबई नाका", "Bonded labour"] },
      { name: "Entitlements", keyterms: ["Ration Card", "PDS Shop", "BPL", "Tehsildar", "FIR", "112 Helpline", "SDM", "गिरफ्तारी", "Legal aid", "शिकायत डायरी"] },
    ],
    sampleUtterance: "Tyre burst at NH-48 near Manesar toll, my truck is standing in the left lane, two people are injured — please send help.",
    sampleTranslation: "एन एच अड़तालीस मानेसर टोल के पास टायर बर्स्ट, मेरा ट्रक बाईं लेन में खड़ा है, दो लोग घायल हैं — मदद भेजिए।",
  },
};

export const WORKFLOW_ORDER: WorkflowDomain[] = ["mandi", "kirana", "asha", "highway_112"];

export function workflowMeta(domain: string): WorkflowMeta {
  return WORKFLOWS[(domain as WorkflowDomain)] ?? WORKFLOWS.mandi;
}

/** Flattened, de-duplicated keyterm pool (Prisma v3.0 accepts up to 200). */
export function keytermsForDomain(domain: WorkflowDomain): string[] {
  const meta = WORKFLOWS[domain];
  if (!meta) return [];
  const merged = meta.clusters.flatMap((cluster) => cluster.keyterms);
  return Array.from(new Set(merged)).slice(0, 200);
}

export function defaultSpeakerNames(domain: WorkflowDomain): string[] {
  const meta = WORKFLOWS[domain];
  return [meta.parties.a.name, meta.parties.b.name].slice(0, 4);
}
