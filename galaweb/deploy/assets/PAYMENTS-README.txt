GALÁPAGOS HOOK ADVENTURE — Payments & booking emails
=====================================================

The booking checkout is fully built and "wired" so you can switch on real
payments and email notifications without changing the design.

Everything below is configured from the ADMIN panel (admin.html → "Site & Contact"),
which writes to the same content store. No code editing required for emails.

--------------------------------------------------------------------
1) RECEIVE BOOKING EMAILS  (no server needed — ~3 min)
--------------------------------------------------------------------
We use Formspree so booking + quote requests are emailed to you.

  1. Go to https://formspree.io and create a free account.
  2. Create a new form and set the destination email to:
        galahookadventure@outlook.com
  3. Copy the form endpoint, it looks like:  https://formspree.io/f/abcdwxyz
  4. Open admin.html → log in → "Site & Contact" → paste it into
     the "formEndpoint" field (you can also edit assets/js/content.js → meta.formEndpoint).
  5. Save. Done — every booking/request is now emailed to you AND stored
     in Admin → "Messages".

(If you leave formEndpoint empty, bookings are still saved in Admin → Messages,
 they just won't be emailed.)

--------------------------------------------------------------------
2) CHARGE REAL CREDIT CARDS WITH STRIPE
--------------------------------------------------------------------
Card charging needs a tiny backend (browsers can't charge cards directly,
for security). The front-end is already prepared:

  - meta.stripeKey  → paste your Stripe *publishable* key (pk_live_… / pk_test_…)
  - The charge hook is in assets/js/app.js → submitBooking()
    (look for the "STRIPE:" comment).

To go live you need a small server endpoint (Netlify/Vercel function, Firebase,
Cloudflare Worker, etc.) that:
  1. creates a Stripe PaymentIntent with the amount, and
  2. returns its client_secret to the page.
Then in submitBooking() call stripe.confirmCardPayment(client_secret, …) before
showing the confirmation screen.

Stripe quickstart: https://stripe.com/docs/payments/quickstart

Until then, the checkout runs in DEMO mode (no real charge) but captures the
full booking, dates, guests and total — and emails/saves it.

--------------------------------------------------------------------
3) WHERE BOOKINGS GO
--------------------------------------------------------------------
  - Admin → "Messages": every booking & quote request (saved in the browser).
  - Email: if a Formspree endpoint is set (step 1).
  - Free cancellation window + min. package guests are configurable in content.js.
