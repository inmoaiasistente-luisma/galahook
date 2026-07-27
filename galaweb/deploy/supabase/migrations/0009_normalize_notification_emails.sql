-- =====================================================================
-- LOAN-IX Booking Engine — 0009_normalize_notification_emails
--
-- Trabaja sobre public.email_notifications, que YA EXISTE (migracion
-- 0007, aplicada). 0007 NO se modifica: se conserva intacta como
-- historial, incluido su constraint uq_email_notification.
--
-- Objetivo: que la idempotencia de correos sea insensible a mayusculas
-- y a espacios. "Cliente@Email.com", "cliente@email.com" y
-- " cliente@email.com " deben ser el MISMO destinatario.
--
-- Esta migracion NO borra filas y NO elige ganadores: si encuentra
-- duplicados se detiene con un error explicito y revierte todo, para
-- que una persona decida que hacer con el historial.
--
-- No toca ninguna tabla de QR (booking_qr_access queda intacta).
-- Ejecutar UNA sola vez.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- A) DETECCION DE DUPLICADOS — antes de tocar nada.
--
--    Se comprueba ANTES del UPDATE a proposito: si dos filas solo se
--    diferencian en mayusculas o espacios, normalizarlas las volveria
--    identicas y el UNIQUE de 0007 fallaria con un 23505 opaco a mitad
--    de la migracion. Comprobando primero, el mensaje es claro y no se
--    ha modificado ni una fila.
-- ---------------------------------------------------------------------
do $$
declare
  g       record;
  grupos  integer := 0;
  filas   integer := 0;
  detalle text    := '';
begin
  for g in
    select booking_id,
           notification_type,
           lower(btrim(recipient_email)) as email_normalizado,
           count(*)                      as n
      from public.email_notifications
     group by 1, 2, 3
    having count(*) > 1
     order by 1, 2, 3
  loop
    grupos := grupos + 1;
    filas  := filas  + g.n;
    if grupos <= 20 then
      detalle := detalle || format(E'\n  booking_id=%s  tipo=%s  email=%s  filas=%s',
                                   g.booking_id, g.notification_type,
                                   g.email_normalizado, g.n);
    end if;
  end loop;

  if grupos > 0 then
    raise exception
      'MIGRACION 0009 ABORTADA: % grupo(s) duplicado(s) (% filas) al normalizar recipient_email.',
      grupos, filas
      using detail = 'Grupos afectados (se muestran hasta 20):' || detalle,
            hint   = 'Revisa cada grupo a mano y decide cual fila conservar. '
                     'La migracion NO borra filas ni elige una arbitrariamente. '
                     'No se ha modificado nada: la transaccion completa se revierte.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- B) NORMALIZACION de las filas existentes.
--    Solo toca las filas que realmente cambian. El trigger
--    trg_email_notifications_updated_at actualizara `updated_at` en
--    esas filas; el resto del historial (status, sent_at, attempts,
--    provider_message_id) no se altera.
-- ---------------------------------------------------------------------
update public.email_notifications
   set recipient_email = lower(btrim(recipient_email))
 where recipient_email <> lower(btrim(recipient_email));

-- ---------------------------------------------------------------------
-- C) VERIFICACION posterior: no puede quedar ninguna fila sin normalizar.
-- ---------------------------------------------------------------------
do $$
declare n integer;
begin
  select count(*) into n
    from public.email_notifications
   where recipient_email <> lower(btrim(recipient_email));
  if n > 0 then
    raise exception 'MIGRACION 0009 ABORTADA: quedan % fila(s) sin normalizar.', n;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- D) INDICE UNICO FUNCIONAL — proteccion case-insensitive.
--    lower() y btrim() son IMMUTABLE, asi que valen como expresion de
--    indice. A partir de aqui la base de datos impide un segundo correo
--    del mismo tipo al mismo destinatario aunque llegue escrito distinto.
-- ---------------------------------------------------------------------
create unique index uq_email_notification_normalized
  on public.email_notifications (
    booking_id,
    notification_type,
    lower(btrim(recipient_email))
  );

comment on index public.uq_email_notification_normalized is
  'Idempotencia de correos insensible a mayusculas y espacios. Complementa (no sustituye) al constraint uq_email_notification de la migracion 0007.';

-- ---------------------------------------------------------------------
-- E) El constraint uq_email_notification de 0007 SE CONSERVA.
--    No se elimina: el indice nuevo anade proteccion, no la reemplaza.
--    Con las filas ya normalizadas ambos coinciden en la practica.
-- ---------------------------------------------------------------------

commit;
