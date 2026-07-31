-- =========================================================
-- 0021 — Guardar el CUERPO de cada comunicación (Fase 9, corrección)
-- ---------------------------------------------------------
-- PREPARADA, NO APLICADA. Requiere autorización del owner antes de ejecutar.
--
-- Para poder ABRIR cada email/comunicación desde el detalle de la reserva y
-- ver el mensaje completo, hay que guardarlo. Añade el cuerpo (html + texto)
-- a las dos tablas que registran envíos:
--   · booking_communications (envíos manuales desde la reserva);
--   · email_notifications    (correos transaccionales + recordatorios).
--
-- Aditiva y mínima: solo columnas de texto nullables. No borra ni cambia nada
-- existente. El código las rellena best-effort: si 0021 no está aplicada, el
-- envío sigue funcionando y el visor muestra "cuerpo no disponible".
-- =========================================================
begin;

alter table public.booking_communications
  add column if not exists body_html text,
  add column if not exists body_text text;

alter table public.email_notifications
  add column if not exists subject   text,
  add column if not exists body_html text,
  add column if not exists body_text text;

commit;
