-- =====================================================================
-- LOAN-IX Booking Engine — 0025_passenger_data_consent
-- Evidencia del consentimiento expreso del formulario de pasajeros
-- (LOPDP Ecuador arts. 21 y 26): datos opcionales de asistencia,
-- alimentacion, accesibilidad o movilidad, y datos de menores autorizados
-- por su representante. passenger-form.js guarda la fecha y la version del
-- texto aceptado; NULL = sin autorizacion. Solo agrega columnas.
-- Ejecutar UNA sola vez, ANTES de desplegar el codigo que las usa.
-- =====================================================================
begin;

alter table public.booking_passenger_forms
  add column if not exists data_consent_at      timestamptz,
  add column if not exists data_consent_version text;

comment on column public.booking_passenger_forms.data_consent_at is
  'Momento en que el cliente marco la autorizacion de datos sensibles/menores en el formulario. NULL = sin autorizacion.';
comment on column public.booking_passenger_forms.data_consent_version is
  'Version del texto de autorizacion aceptado (DATA_CONSENT_VERSION en server/lib/passenger-intake.js).';

commit;
