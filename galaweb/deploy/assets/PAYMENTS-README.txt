GALÁPAGOS HOOK ADVENTURE — Pagos, reservas y correos
=====================================================

ESTE ARCHIVO ES SOLO INFORMATIVO.
No hay nada que configurar aquí ni en assets/js/content.js.

Todo lo que este documento describía antes (modo demo, Formspree,
"pega tu clave de Stripe en content.js", Admin → Messages) YA NO EXISTE.
El sistema real está conectado y funciona así:


1) COBROS
---------
Stripe Elements, en la propia página, sin salir a Stripe Checkout.

  · El navegador NUNCA envía el importe. Manda tour_id y número de
    viajeros; el precio lo calcula el servidor con el catálogo
    autorizado (server/lib/tour-catalog.js).
  · /api/create-payment-intent crea el PaymentIntent y devuelve solo el
    client_secret.
  · /api/stripe-config sirve la clave PUBLICABLE desde una variable de
    entorno. La clave secreta nunca sale del servidor.
  · /api/stripe-webhook confirma el pago con firma verificada y raw body,
    y marca la reserva como paid + confirmed.


2) DÓNDE VIVEN LAS RESERVAS
---------------------------
En Supabase. No en el navegador.

No se guarda ninguna reserva en localStorage y el navegador nunca habla
directamente con Supabase: todo pasa por las funciones del servidor con
la clave secreta.


3) CORREOS
----------
Los envía el servidor con Resend, no el navegador.

  · Al cliente: confirmación bilingüe (inglés y español) con el código QR.
  · Interno: aviso a BOOKING_NOTIFICATION_EMAIL.
  · Cotizaciones y ventas directas tienen sus propios correos.
  · Un mismo correo nunca se envía dos veces (idempotencia en base de datos).


4) CONFIGURACIÓN
----------------
Toda la configuración sensible vive en variables de entorno de Vercel:
Stripe, Supabase, Resend, TENANT_ID, SESSION_SECRET, QR_SIGNING_SECRET y
PUBLIC_SITE_URL. Ver .env.example (plantilla, sin valores reales) y
docs/go-live-checklist.md.

⚠️ NUNCA pegues una clave, un token ni un endpoint externo en
   assets/js/content.js ni en ningún archivo de assets/: todo lo que hay
   en esa carpeta se descarga al navegador y sería público.


5) EL PANEL
-----------
admin.html usa login multiusuario (Supabase Auth) con roles
owner / admin / staff y sesión firmada del lado del servidor.
Ver docs/admin-auth.md.
