-- ============================================================================
-- DHWANI-RAKSHA / MUDRA-VANI OMEGA — initial schema (20261113000000)
-- Postgres 15+ / Supabase. Run in SQL editor or `supabase db push`.
--
-- Design notes
--  * voiceprint_vault keeps BOTH representations: the raw `torch.bfloat16`
--    payload as returned by Gnani (byte-exact, re-synthesisable) and a float32
--    vector(768) for cosine search. bfloat16 -> float32 is an exact upcast.
--  * rag_keyterm_clusters powers RAG-steered Prisma v3.0 context injection
--    (<= 200 keyterms, topic <= 1600 chars come from here).
--  * boli_patra_ledger is an append-only SHA-256 hash chain: prev_ledger_hash
--    + both voiceprint digests + canonical contract JSON -> sha256_audit_hash.
--  * tts_audio_cache is content addressed: sha256(text|model|voice_or_embed|lang).
-- ============================================================================

create extension if not exists "vector";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- voiceprints
create table if not exists public.voiceprint_vault (
  id                    uuid primary key default gen_random_uuid(),
  user_handle           text not null,
  role                  text not null check (role in ('farmer','trader','kirana','asha','citizen','trader_b')),
  preferred_language    text not null default 'hi-IN',
  embedding_bfloat16_b64 text not null,
  embedding_vec         vector(768) not null,
  embedding_digest      text not null,
  sample_seconds        numeric(5,2),
  verified_threshold    numeric(4,3) not null default 0.860,
  created_at            timestamptz not null default now()
);

create index if not exists voiceprint_vault_embedding_hnsw
  on public.voiceprint_vault using hnsw (embedding_vec vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create unique index if not exists voiceprint_vault_handle_lang
  on public.voiceprint_vault (user_handle, preferred_language);

-- ------------------------------------------------------------- keyterm RAG
create table if not exists public.rag_keyterm_clusters (
  id               uuid primary key default gen_random_uuid(),
  workflow_domain  text not null check (workflow_domain in ('mandi','kirana','asha','highway_112')),
  region_pin_prefix text not null default '110',
  language_code    text not null default 'hi-IN',
  cluster_name     text not null,
  keyterms_array   text[] not null check (array_length(keyterms_array, 1) <= 200),
  topic_template   text not null check (char_length(topic_template) <= 1600),
  cluster_embedding vector(384),
  priority         int not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists rag_keyterm_clusters_lookup
  on public.rag_keyterm_clusters (workflow_domain, language_code, region_pin_prefix);

create index if not exists rag_keyterm_clusters_embedding_hnsw
  on public.rag_keyterm_clusters using hnsw (cluster_embedding vector_cosine_ops);

-- --------------------------------------------------------- Boli-Patra ledger
create table if not exists public.boli_patra_ledger (
  id                      uuid primary key default gen_random_uuid(),
  workflow_domain         text not null,
  party_a_id              uuid references public.voiceprint_vault(id) on delete set null,
  party_b_id              uuid references public.voiceprint_vault(id) on delete set null,
  party_a_name            text not null,
  party_b_name            text not null,
  party_a_language        text not null,
  party_b_language        text not null,
  party_a_voiceprint_hash text not null,
  party_b_voiceprint_hash text not null,
  party_a_cosine_score    numeric(4,3),
  party_b_cosine_score    numeric(4,3),
  source_transcript       text not null,
  translated_transcript   text,
  detected_language       text,
  structured_contract     jsonb not null,
  sha256_audit_hash       text not null,
  prev_ledger_hash        text,
  audio_proof_url         text,
  status                  text not null default 'minted' check (status in ('draft','pending','minted','verified','rejected')),
  created_at              timestamptz not null default now()
);

create index if not exists boli_patra_ledger_created_idx on public.boli_patra_ledger (created_at desc);
create index if not exists boli_patra_ledger_domain_idx on public.boli_patra_ledger (workflow_domain, created_at desc);
create unique index if not exists boli_patra_ledger_hash_idx on public.boli_patra_ledger (sha256_audit_hash);

-- ------------------------------------------------------- credit accounting
create table if not exists public.gnani_credit_ledger (
  id                uuid primary key default gen_random_uuid(),
  mode              text not null check (mode in ('mock','live')),
  call_kind         text not null,             -- stt_rest | stt_ws | tts_rest | tts_sse | vc_embed
  model             text not null,
  request_id        text,
  http_status       int,
  error_code        text,
  queued_ms         numeric(10,2) not null default 0,
  latency_ms        numeric(10,2) not null default 0,
  credits           numeric(10,4) not null default 0,
  credits_exactness text not null default 'estimated' check (credits_exactness in ('exact','estimated')),
  workflow_domain   text,
  created_at        timestamptz not null default now()
);

create index if not exists gnani_credit_ledger_recent on public.gnani_credit_ledger (created_at desc);

-- --------------------------------------------------------- TTS audio cache
create table if not exists public.tts_audio_cache (
  text_sha256          text primary key,
  model                text not null,
  voice_or_embedding_hash text not null,
  language             text not null,
  normalized_text      text not null,
  audio_url            text not null,
  container            text not null default 'wav',
  sample_rate          int not null default 48000,
  duration_ms          int,
  credits_saved_count  int not null default 0,
  created_at           timestamptz not null default now()
);

-- ------------------------------------------------------- verification audit
create table if not exists public.voice_verification_events (
  id           uuid primary key default gen_random_uuid(),
  voiceprint_id uuid references public.voiceprint_vault(id) on delete cascade,
  cosine       numeric(4,3) not null,
  band         text not null check (band in ('verified','noisy_warning','rejected')),
  threshold_verified numeric(4,3) not null default 0.860,
  threshold_noisy    numeric(4,3) not null default 0.740,
  workflow_domain text,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------ ASHA triage
create table if not exists public.asha_triage_log (
  id                   uuid primary key default gen_random_uuid(),
  patient_handle       text not null,
  language             text not null,
  clinical_triage_level text not null check (clinical_triage_level in ('routine','watch','urgent','emergency')),
  vitals               jsonb not null default '{}'::jsonb,
  symptoms_text        text,
  tts_tags             text[] not null default '{}',
  model                text,
  ledger_id            uuid references public.boli_patra_ledger(id) on delete set null,
  created_at           timestamptz not null default now()
);

create index if not exists asha_triage_log_recent on public.asha_triage_log (created_at desc);

-- ------------------------------------------------ atomic ledger append RPC
create or replace function public.append_boli_patra(payload jsonb)
returns public.boli_patra_ledger
language plpgsql
security definer
as $$
declare
  previous text;
  inserted public.boli_patra_ledger;
begin
  select sha256_audit_hash into previous
    from public.boli_patra_ledger
    order by created_at desc
    limit 1
    for update;

  insert into public.boli_patra_ledger (
    workflow_domain, party_a_id, party_b_id, party_a_name, party_b_name,
    party_a_language, party_b_language, party_a_voiceprint_hash, party_b_voiceprint_hash,
    party_a_cosine_score, party_b_cosine_score, source_transcript, translated_transcript,
    detected_language, structured_contract, sha256_audit_hash, prev_ledger_hash, audio_proof_url, status
  ) values (
    payload->>'workflow_domain',
    nullif(payload->>'party_a_id','')::uuid,
    nullif(payload->>'party_b_id','')::uuid,
    payload->>'party_a_name', payload->>'party_b_name',
    payload->>'party_a_language', payload->>'party_b_language',
    payload->>'party_a_voiceprint_hash', payload->>'party_b_voiceprint_hash',
    nullif(payload->>'party_a_cosine_score','')::numeric,
    nullif(payload->>'party_b_cosine_score','')::numeric,
    payload->>'source_transcript',
    payload->>'translated_transcript',
    payload->>'detected_language',
    payload->'structured_contract',
    payload->>'sha256_audit_hash',
    previous,
    payload->>'audio_proof_url',
    coalesce(payload->>'status','minted')
  ) returning * into inserted;

  return inserted;
end;
$$;

-- ------------------------------------------------------- row level security
alter table public.voiceprint_vault enable row level security;
alter table public.boli_patra_ledger enable row level security;
alter table public.rag_keyterm_clusters enable row level security;
alter table public.tts_audio_cache enable row level security;
alter table public.gnani_credit_ledger enable row level security;
alter table public.asha_triage_log enable row level security;

-- The dashboard talks to Supabase with the service-role key from Next.js route
-- handlers, so service_role bypasses RLS. Public read of the ledger only.
drop policy if exists "ledger readable" on public.boli_patra_ledger;
create policy "ledger readable" on public.boli_patra_ledger for select using (true);

drop policy if exists "keyterms readable" on public.rag_keyterm_clusters;
create policy "keyterms readable" on public.rag_keyterm_clusters for select using (true);

-- ------------------------------------------------------------ seed anchors
insert into public.rag_keyterm_clusters (workflow_domain, region_pin_prefix, language_code, cluster_name, keyterms_array, topic_template)
values
  ('mandi','422','mr-IN','Lasalgaon onion trade',array['लहसुन','कांदा','क्विंटल','भाव','हमाली','तुलाई','आढत','e-NAM','Lasalgaon Red','Nashik Gavran'],'APMC onion auction between a Nashik farmer and an interstate trader. Bargain on quintal rate, hamali and katai.'),
  ('kirana','110','hi-IN','Kirana udhaar ledger',array['उधार','खाता','पर्चा','GSTIN','UTR','UPI','पारले जी','फॉर्च्यून कच्ची घानी','मैगी','बाकी'],'Hinglish kirana billing session. Build a GST invoice from spoken items and log customer credit.'),
  ('asha','846','hi-IN','ASHA maternal triage',array['गर्भवती','टीकाकरण','ORS','पैरासिटामोल','SpO2','बीपी','PHC','आंगनवाड़ी','जननी सुरक्षा','आयरन फोलिक एसिड'],'Rural maternal and child health triage by an ASHA worker. Capture symptoms and vitals, assign triage level.'),
  ('highway_112','110','en-IN','NH-48 emergency beacon',array['NH-48','Fastag','Tyre Burst','112 Helpline','Ration Card','PDS','BPL','Tehsildar','FIR','Toll'],'Highway and citizen grievance call. Classify emergency vs grievance and preserve testimony anonymously.')
on conflict do nothing;
