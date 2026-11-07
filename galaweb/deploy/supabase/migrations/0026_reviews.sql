-- =====================================================================
-- LOAN-IX Booking Engine — 0026_reviews
-- Reseñas por QR: lo que el pasajero envía desde /resena y la nota pública
-- de Google que el owner mantiene al día desde el panel.
-- APLICADA en Producción el 2026-11-06 con autorización del owner.
-- La columna translation quedó sin uso: cada reseña se muestra en su idioma.
--
-- Toda reseña entra en 'pending'. Solo el owner publica o rechaza, y el
-- texto del pasajero no se edita. No se guarda IP.
-- client_key lo genera el navegador: hace que reintentar no duplique y deja
-- marcar más tarde que el pasajero abrió Google. Nunca sale hacia el panel
-- ni hacia el sitio público.
-- =====================================================================
begin;

create table public.reviews (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        text not null default 'hook-adventure',
  created_at       timestamptz not null default now(),
  client_key       uuid not null,
  rating           smallint not null,
  body             text,
  author_name      text not null,
  lang             text not null,
  opened_google    boolean not null default false,
  consent_version  text not null,
  status           text not null default 'pending',
  translation      text,
  trip             text,
  reject_reason    text,
  handled_by       text,
  handled_at       timestamptz,
  published_at     timestamptz,

  constraint uq_reviews_client_key unique (tenant_id, client_key),
  constraint chk_reviews_rating check (rating between 1 and 5),
  constraint chk_reviews_body_len check (body is null or char_length(body) between 1 and 1000),
  constraint chk_reviews_name_len check (char_length(author_name) between 2 and 80),
  constraint chk_reviews_lang check (lang in ('en', 'es')),
  constraint chk_reviews_status check (status in ('pending', 'published', 'rejected')),
  constraint chk_reviews_translation_len check (translation is null or char_length(translation) <= 1500),
  constraint chk_reviews_trip check (trip is null or trip in ('day_tour', 'sport_fishing', 'all_inclusive', 'diving', 'private_trip')),
  constraint chk_reviews_reject_reason check (reject_reason is null or reject_reason in ('spam', 'abuse', 'third_party_data', 'not_passenger')),
  constraint chk_reviews_published_body check (status <> 'published' or body is not null),
  constraint chk_reviews_published_at check (status <> 'published' or published_at is not null),
  constraint chk_reviews_rejected_reason check ((status = 'rejected') = (reject_reason is not null))
);

create index idx_reviews_public on public.reviews (tenant_id, status, published_at desc);
create index idx_reviews_inbox on public.reviews (tenant_id, created_at desc);

comment on table public.reviews is
  'Reseñas enviadas desde /resena. Moderadas por el owner. Sin IP. Solo backend (secret key).';
comment on column public.reviews.client_key is
  'UUID generado por el navegador para reintentos idempotentes y para marcar opened_google. No se expone.';
comment on column public.reviews.opened_google is
  'El pasajero abrió el formulario de Google. No prueba que publicara: Google no lo informa.';
comment on column public.reviews.consent_version is
  'Versión del aviso de publicación mostrado (CONSENT_VERSION en server/lib/reviews.js).';

create table public.review_settings (
  tenant_id      text primary key default 'hook-adventure',
  google_rating  numeric(2,1),
  google_count   integer,
  updated_by     text,
  updated_at     timestamptz not null default now(),

  constraint chk_review_settings_rating check (google_rating is null or google_rating between 1 and 5),
  constraint chk_review_settings_count check (google_count is null or google_count >= 0)
);

comment on table public.review_settings is
  'Nota y número de reseñas de Google que muestra el sitio. Las escribe el owner: Google no las entrega sin su API de pago.';

-- Valores vistos en la ficha de Google el 2026-11-06.
insert into public.review_settings (tenant_id, google_rating, google_count, updated_by)
values ('hook-adventure', 5.0, 2, 'migracion-0026');

alter table public.reviews enable row level security;
alter table public.review_settings enable row level security;
revoke all on table public.reviews from anon, authenticated;
revoke all on table public.review_settings from anon, authenticated;

commit;
