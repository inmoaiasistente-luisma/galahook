-- =====================================================================
-- 0017 — Milu Turismo: el claim de subtareas SOLO reclama 'queued'
-- ---------------------------------------------------------------------
-- BUG (0015): milu_claim_next_subtask reclamaba status in ('queued','partial').
-- Una subtarea que termina 'partial' (p.ej. provider_not_connected) volvía a
-- ser elegible y se reclamaba en cada pasada del worker, sin avanzar nunca a
-- las siguientes subtareas (web_research_flights / web_research_lodging).
--
-- FIX: reclamar SOLO 'queued'. Los estados terminales (completed, partial,
-- failed, cancelled) NO se reclaman. Los REINTENTOS siguen funcionando porque
-- vuelven a 'queued' con next_attempt_at (vía milu_reclaim_expired_leases o
-- failOrRetrySubtask): "retryable" = queued con next_attempt_at ya vencido.
--
-- Idempotente y no destructivo: solo CREATE OR REPLACE de la función. NO toca
-- tablas, datos, leases ni milu_reclaim_expired_leases. Aditiva sobre 0015/0016.
-- =====================================================================

begin;

create or replace function public.milu_claim_next_subtask(
  p_tenant text, p_worker text, p_lease_seconds integer
) returns public.travel_search_subtasks
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.travel_search_subtasks;
begin
  if p_tenant is null or length(btrim(p_tenant)) = 0 then
    raise exception 'milu_claim: invalid tenant';
  end if;
  if p_worker is null or length(btrim(p_worker)) = 0 then
    raise exception 'milu_claim: invalid worker';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'milu_claim: lease_seconds out of range (15-300)';
  end if;

  select s.* into v_row
    from public.travel_search_subtasks s
    join public.travel_search_jobs j
      on j.id = s.job_id and j.tenant_id = s.tenant_id
   where s.tenant_id = p_tenant
     and s.status = 'queued'                    -- SOLO queued (antes: in ('queued','partial'))
     and s.attempt_count < s.max_attempts
     and (s.lease_expires_at is null or s.lease_expires_at < now())
     and (s.next_attempt_at is null or s.next_attempt_at <= now())
     and j.active = true
     and j.status in ('queued','running','partial')
   order by s.created_at asc
   for update of s skip locked
   limit 1;
  if not found then return null; end if;

  update public.travel_search_subtasks
     set status = 'running',
         locked_by = p_worker,
         locked_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         heartbeat_at = now(),
         attempt_count = attempt_count + 1,
         started_at = coalesce(started_at, now()),
         updated_at = now()
   where id = v_row.id
  returning * into v_row;
  return v_row;
end $$;

-- CREATE OR REPLACE conserva los grants existentes; se re-emiten por claridad.
revoke execute on function public.milu_claim_next_subtask(text, text, integer) from public, anon, authenticated;
grant  execute on function public.milu_claim_next_subtask(text, text, integer) to service_role;

commit;
