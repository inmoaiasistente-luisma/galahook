begin;

alter table public.bookings
add column if not exists client_request_id uuid;

create unique index if not exists uq_bookings_tenant_client_request
  on public.bookings (tenant_id, client_request_id)
  where client_request_id is not null;

commit;
