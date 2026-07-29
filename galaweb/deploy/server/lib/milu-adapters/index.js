'use strict';

/* =========================================================
   Milu Turismo — registro de adapters
   ---------------------------------------------------------
   Interfaz única. Un adapter por fuente, intercambiable sin
   reescribir Milu. En 8C solo existen `stub` y `manual` (dev /
   fallback). En 8D se añade `duffel` (vuelos); en 8E el proveedor
   hotelero elegido y `airbnb_link`. Los adapters reales solo se
   habilitan cuando su feature flag está activa (ver milu-flags).
   ========================================================= */

const stub = require('./stub');
const manual = require('./manual');

const FLIGHT_ADAPTERS = { stub: stub, manual: manual };
const HOTEL_ADAPTERS = { stub: stub, manual: manual };

function getFlightAdapter(name) { return FLIGHT_ADAPTERS[name] || manual; }
function getHotelAdapter(name) { return HOTEL_ADAPTERS[name] || manual; }

module.exports = { getFlightAdapter, getHotelAdapter, FLIGHT_ADAPTERS, HOTEL_ADAPTERS };
