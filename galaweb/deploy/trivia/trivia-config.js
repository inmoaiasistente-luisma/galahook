/* =========================================================================
   Galápagos Hook Trivia — configuración en tiempo de ejecución
   -------------------------------------------------------------------------
   Este archivo se sirve SIN hash en /trivia/trivia-config.js y se puede
   editar en producción SIN recompilar el juego.

   Para activar el multijugador con salas QR (Fase 3), cuando el servidor
   de salas esté publicado por HTTPS:
     1) onlineEnabled: true
     2) realtimeUrl: "https://TU-SERVIDOR-DE-SALAS"   (p. ej. https://play.galapagoshookadventure.com)

   Mientras onlineEnabled sea false, el juego funciona en modo individual y
   local ("pass & play"); la opción online queda oculta y no genera errores.
   ========================================================================= */
window.__TRIVIA__ = Object.assign(
  { realtimeUrl: '', onlineEnabled: false },
  window.__TRIVIA__ || {}
);
