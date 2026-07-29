# Contrato de requerimientos de viaje (Milu Turismo)

Etapa 8. **No implementa** búsqueda ni reserva de vuelos/hoteles. Solo define
la **salida estructurada** que el conector autorizado (Milu Turismo) consumirá
más adelante.

## Función

`buildTravelRequirements(booking_id)` en `server/lib/passenger-intake.js`
(server-only). Lee la reserva, su formulario de intake, los pasajeros, el
alojamiento por destino y los hoteles preferidos, y devuelve un objeto listo
para el conector. **No ejecuta búsquedas.**

## Forma del contrato

```json
{
  "booking_code": "HA-2026-XXXXXX",
  "tour": { "id": "p4", "name": "..." },
  "travel_date": "2026-09-12",
  "passenger_count": 3,
  "preferred_connection_city": "quito | guayaquil | either",
  "arrival": {
    "international_flights_purchased": true,
    "ecuador_arrival_date": "2026-09-10",
    "ecuador_arrival_time": "14:30",
    "arrival_airport": "UIO"
  },
  "passengers": [
    {
      "passenger_number": 1,
      "legal_first_name": "...", "legal_middle_name": "...", "legal_last_name": "...",
      "age_category": "infant | child | adult",
      "nationality": "...",
      "document_type": "passport | national_id | other",
      "document_expiration_date": "2030-01-01",
      "issuing_country": "...",
      "special_assistance": "...",
      "dietary_requirements": "...",
      "accessibility_or_mobility_needs": "...",
      "baggage_notes": "..."
    }
  ],
  "lodging_requirements": [
    {
      "destination": "quito | guayaquil | san_cristobal | santa_cruz | isabela | connection_tbd",
      "lodging_required": true,
      "check_in_date": null, "check_out_date": null, "nights": 2,
      "guest_count": 3, "rooms_required": 2,
      "room_preferences": "...", "approximate_budget_cents": 12000,
      "accessibility_notes": "...",
      "pending_resolution": false
    }
  ],
  "hotel_search_preferences": [
    { "destination": "guayaquil", "hotel_name": "Holiday Inn (cercano al aeropuerto)",
      "priority": 1, "preference_notes": "...", "search_aliases": [] }
  ]
}
```

## Categorías de edad

Calculadas **a la fecha del viaje** (`travel_date`), no la edad actual:

- `infant`: menor de 2 años
- `child`: 2 a 11 años
- `adult`: 12 años o más

La clasificación final puede depender de las reglas específicas de cada
aerolínea y será **recalculada por el conector autorizado**.

## Reglas de hoteles preferidos

Viven en `public.hotel_search_preferences` (configurable por owner/admin), no
hardcodeadas en Milu ni en el frontend. El conector debe:

1. Intentar primero los hoteles preferidos por `priority` ascendente.
2. Si no cumplen disponibilidad, capacidad, fechas, presupuesto o condiciones,
   buscar alternativas comparables.
3. Explicar posteriormente por qué se descartó el preferido.

`connection_tbd` en `lodging_requirements` significa que el cliente eligió
"cualquiera de las dos ciudades": **no debe enviarse a búsqueda** hasta que
owner/admin lo resuelva a `quito` o `guayaquil` (marcado con
`pending_resolution: true`).

## El contrato NUNCA incluye

- Número de documento completo (solo `document_type` y expiración).
- Datos financieros internos: `cost_cents`, descuentos, `pricing_snapshot`,
  utilidades. (El `approximate_budget_cents` de alojamiento es la preferencia
  del cliente, no finanzas internas.)
- Tokens del formulario ni secretos de ningún tipo.
