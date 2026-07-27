-- =====================================================================
-- INFORME DE DATOS DE PRUEBA — SOLO LECTURA
--
-- Ninguna consulta de este archivo modifica nada. NO hay DELETE, ni
-- UPDATE, ni DROP. Sirve para que una persona vea exactamente que hay
-- antes de decidir que borrar.
--
-- Uso: Supabase -> SQL Editor. Ejecutar por bloques.
-- El borrado, si se decide, va al final (comentado a proposito).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0) PANORAMA GENERAL
-- ---------------------------------------------------------------------
select
  count(*)                                                as reservas_totales,
  count(*) filter (where request_type = 'booking')        as reservas,
  count(*) filter (where request_type = 'quote')          as cotizaciones,
  count(*) filter (where sales_channel = 'web')           as canal_web,
  count(*) filter (where sales_channel = 'agency')        as canal_agencia,
  count(*) filter (where payment_status = 'paid')         as pagadas,
  count(*) filter (where payment_status = 'pending')      as pendientes,
  count(*) filter (where payment_status = 'failed')       as fallidas,
  min(created_at)                                         as primera,
  max(created_at)                                         as ultima
from public.bookings;


-- ---------------------------------------------------------------------
-- 1) TODAS LAS RESERVAS, agrupadas por los campos que pediste
--    Revisar a ojo: los datos de prueba suelen delatarse por el correo
--    o por un nombre evidente.
-- ---------------------------------------------------------------------
select
  booking_code,
  customer_email,
  created_at,
  sales_channel,
  payment_status,
  booking_status,
  request_type,
  tour_name,
  booking_date,
  guests,
  amount_cents,
  stripe_payment_intent_id
from public.bookings
order by created_at desc;


-- ---------------------------------------------------------------------
-- 2) RESUMEN POR CORREO — cuantas reservas dejo cada direccion
--    Un correo con muchas reservas y montos raros casi siempre es prueba.
-- ---------------------------------------------------------------------
select
  coalesce(customer_email, '(sin correo)')          as customer_email,
  count(*)                                          as reservas,
  min(created_at)                                   as primera,
  max(created_at)                                   as ultima,
  string_agg(distinct sales_channel, ', ')          as canales,
  string_agg(distinct payment_status, ', ')         as estados_pago,
  sum(coalesce(amount_cents, 0))                    as suma_cents
from public.bookings
group by 1
order by reservas desc, ultima desc;


-- ---------------------------------------------------------------------
-- 3) CANDIDATAS A DATO DE PRUEBA
--    Heuristica, NO veredicto: revisa una por una antes de borrar.
--    Ajusta los patrones a los correos que usaste realmente.
-- ---------------------------------------------------------------------
select
  booking_code, customer_email, customer_name, created_at,
  sales_channel, payment_status, booking_status, amount_cents,
  case
    when customer_email is null                                   then 'sin correo'
    when customer_email ~* '(example\.com|test|prueba|mailinator|yopmail|\+test)' then 'correo de prueba'
    when customer_name  ~* '(test|prueba|asdf|qwer|xxx)'           then 'nombre de prueba'
    when payment_status in ('pending','failed')                   then 'pago no completado'
    when stripe_payment_intent_id like 'pi_%test%'                then 'PaymentIntent de prueba'
    else 'revisar'
  end                                                             as motivo
from public.bookings
where customer_email is null
   or customer_email ~* '(example\.com|test|prueba|mailinator|yopmail|\+test)'
   or customer_name  ~* '(test|prueba|asdf|qwer|xxx)'
   or payment_status in ('pending','failed')
order by created_at desc;


-- ---------------------------------------------------------------------
-- 4) COTIZACIONES
-- ---------------------------------------------------------------------
select booking_code, customer_email, customer_name, created_at,
       tour_name, booking_date, guests, booking_status, notes
from public.bookings
where request_type = 'quote'
order by created_at desc;


-- ---------------------------------------------------------------------
-- 5) CORREOS ENVIADOS (email_notifications)
-- ---------------------------------------------------------------------
select
  n.created_at,
  b.booking_code,
  n.notification_type,
  n.recipient_email,
  n.status,
  n.attempts,
  n.sent_at,
  left(coalesce(n.last_error, ''), 80) as error
from public.email_notifications n
join public.bookings b on b.id = n.booking_id
order by n.created_at desc;

-- Resumen por destinatario y estado
select recipient_email, status, count(*) as correos,
       min(created_at) as primero, max(created_at) as ultimo
from public.email_notifications
group by 1, 2
order by correos desc;

-- Notificaciones que quedaron en 'failed' (candidatas a reintentar o a limpiar)
select n.id, b.booking_code, n.notification_type, n.recipient_email,
       n.attempts, left(coalesce(n.last_error,''), 120) as error
from public.email_notifications n
join public.bookings b on b.id = n.booking_id
where n.status = 'failed'
order by n.created_at desc;


-- ---------------------------------------------------------------------
-- 6) ACCESOS QR (booking_qr_access)
--    Nota: aqui NO se guarda ningun token, solo el identificador publico.
-- ---------------------------------------------------------------------
select
  q.created_at,
  b.booking_code,
  b.customer_email,
  b.booking_status,
  q.token_version,
  q.active,
  q.expires_at,
  q.scan_count,
  q.last_scanned_at,
  q.revoked_at
from public.booking_qr_access q
join public.bookings b on b.id = q.booking_id
order by q.created_at desc;

-- QR ya caducados o revocados
select b.booking_code, q.active, q.revoked_at, q.expires_at, q.scan_count
from public.booking_qr_access q
join public.bookings b on b.id = q.booking_id
where q.active = false or (q.expires_at is not null and q.expires_at < now())
order by q.created_at desc;


-- ---------------------------------------------------------------------
-- 7) EVENTOS DE STRIPE PROCESADOS
--    Son el registro de idempotencia del webhook. Se pueden conservar
--    sin problema: no contienen datos del cliente.
-- ---------------------------------------------------------------------
select stripe_event_id, event_type, processing_status, received_at, processed_at,
       left(coalesce(last_error, ''), 80) as error
from public.stripe_webhook_events
order by processed_at desc
limit 100;


-- ---------------------------------------------------------------------
-- 8) COMPROBACION FINAL — ejecutar DESPUES de limpiar
--    Todo esto deberia salir vacio o con solo datos reales.
-- ---------------------------------------------------------------------
select 'reservas con correo de prueba' as comprobacion, count(*) as filas
from public.bookings
where customer_email ~* '(example\.com|test|prueba|mailinator|yopmail)'
union all
select 'reservas sin pago completado', count(*)
from public.bookings
where request_type = 'booking' and payment_status not in ('paid','refunded')
union all
select 'notificaciones failed', count(*)
from public.email_notifications where status = 'failed'
union all
select 'QR huerfanos', count(*)
from public.booking_qr_access q
where not exists (select 1 from public.bookings b where b.id = q.booking_id);


-- =====================================================================
-- BORRADO — DELIBERADAMENTE COMENTADO
--
-- No lo ejecutes hasta haber revisado los bloques 1 a 6 y haber anotado
-- que booking_code vas a eliminar.
--
-- email_notifications y booking_qr_access tienen ON DELETE CASCADE:
-- borrar la reserva arrastra sus correos y su acceso QR.
--
-- Descomenta, pon TUS codigos y ejecuta primero el SELECT de control.
-- =====================================================================

-- -- 1) Control: mira EXACTAMENTE que vas a borrar
-- select booking_code, customer_email, created_at, payment_status, amount_cents
-- from public.bookings
-- where booking_code in ('HA-2026-XXXXXX', 'HA-2026-YYYYYY');

-- -- 2) Borrado (solo si el SELECT anterior muestra lo que esperas)
-- begin;
--   delete from public.bookings
--   where booking_code in ('HA-2026-XXXXXX', 'HA-2026-YYYYYY');
--   -- Revisa el numero de filas afectadas ANTES de confirmar:
--   -- si no cuadra, ejecuta rollback; en lugar de commit;
-- commit;
