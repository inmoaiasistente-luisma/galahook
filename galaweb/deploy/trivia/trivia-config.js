/* =========================================================================
   Galápagos Hook Trivia — configuración en tiempo de ejecución
   -------------------------------------------------------------------------
   Este archivo se sirve SIN hash en /trivia/trivia-config.js y se puede
   editar en producción SIN recompilar el juego.

   Por ahora el juego es solo de 1 jugador. Los modos multijugador quedan
   CONSTRUIDOS y se reactivan aquí, sin recompilar:

     • Familia en un dispositivo (pass & play):
         localEnabled: true

     • Sala privada con QR (multijugador online, Fase 3) — requiere el
       servidor de salas publicado por HTTPS (apps/realtime + railway.json):
         onlineEnabled: true
         realtimeUrl: "https://TU-SERVIDOR-DE-SALAS"

   Mientras ambos flags sean false, solo aparece el modo "1 jugador" y no se
   genera ningún error.
   ========================================================================= */
window.__TRIVIA__ = Object.assign(
  { realtimeUrl: '', onlineEnabled: false, localEnabled: false },
  window.__TRIVIA__ || {}
);
