-- =====================================================================
-- LOAN-IX Booking Engine — 0024_discount_rule_codes
-- Codigo de canje opcional en discount_rules (redes sociales/ManyChat).
-- NULL = regla automatica (comportamiento actual, sin cambios). Con
-- codigo, la regla SOLO aplica si el cliente lo escribe en el checkout
-- (pricing-engine.js la excluye del filtro automatico sin coincidencia).
-- Ejecutar UNA sola vez.
-- =====================================================================
begin;

alter table public.discount_rules add column if not exists code text;

alter table public.discount_rules add constraint chk_discount_code_format
  check (code is null or code ~ '^[A-Z0-9_-]{2,30}$');

comment on column public.discount_rules.code is
  'Codigo de canje opcional (mayusculas, 2-30 chars). NULL = regla automatica. Con codigo, el cliente debe escribirlo en el checkout para que aplique.';

create index if not exists idx_dr_code on public.discount_rules (code);

commit;
