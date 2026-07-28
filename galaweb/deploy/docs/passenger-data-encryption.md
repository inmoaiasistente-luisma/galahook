# Cifrado de datos de documentos de pasajeros

El **número de documento** de cada pasajero se guarda **cifrado** con
AES-256-GCM (cifrado autenticado). Nunca se almacena en claro, nunca se
registra en logs, nunca viaja en correos y nunca se muestra a staff.

Implementación: `server/lib/passenger-crypto.js`.

## Variables de entorno (keyring)

| Variable | Descripción |
|---|---|
| `PASSENGER_DATA_ENCRYPTION_ACTIVE_KEY_ID` | id de la clave **activa** (con la que se cifra lo nuevo), p. ej. `k1`. |
| `PASSENGER_DATA_ENCRYPTION_KEYS_JSON` | mapa JSON `{ "k1": "<base64 32B>", ... }` de todas las claves disponibles. |

Generar una clave de 32 bytes:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> Nunca coloques valores reales en el código, pruebas, logs ni documentación.

## Columnas en `booking_passengers`

- `document_number_ciphertext` (base64)
- `document_number_iv` (base64, IV aleatorio de 12 bytes)
- `document_number_auth_tag` (base64, tag GCM de 16 bytes)
- `document_number_last4` (para mostrar enmascarado `****1234`)
- `document_number_key_id` (id de la clave con la que se cifró esa fila)

## AAD (datos adicionales autenticados)

El cifrado liga el ciphertext a la identidad del pasajero mediante AAD:

```
tenant_id | passenger_form_id | passenger_number | document_type
```

Si el ciphertext se **mueve** a otro pasajero, formulario o tenant, o si se
altera un byte, el descifrado **falla** (GCM lo detecta). Al cambiar el
`document_type` sin reescribir el número, el servidor **re-cifra** con el AAD
nuevo (descifra con el tipo anterior y vuelve a cifrar con el nuevo).

## Cifrar / descifrar

- **Cifrar:** siempre con la clave **activa** (`ACTIVE_KEY_ID`). Se guarda el
  `key_id` usado.
- **Descifrar:** con la clave indicada por `document_number_key_id`. Solo
  owner/admin pueden solicitar el valor en claro por el endpoint
  `passenger-document-reveal`, que exige `sameOrigin`, un **motivo obligatorio**
  y una **escritura de auditoría exitosa** (si no puede auditar, no revela).
- **Staff:** solo recibe el valor enmascarado `****1234` (columna `last4`),
  nunca el número completo.

## Auditoría

Cada acceso queda en `public.passenger_document_access_audit`
(`reveal`, `decrypt_failed`, `rotate_key`, `export_for_authorized_provider`)
con usuario, rol, motivo, resultado, IP enmascarada y user-agent saneado.
**Nunca** guarda el número, el ciphertext, tokens ni secretos.

## Rotación y retiro seguro de claves

1. Genera una clave nueva (`k2`) y agrégala a `PASSENGER_DATA_ENCRYPTION_KEYS_JSON`
   **manteniendo** la anterior (`k1`).
2. Cambia `PASSENGER_DATA_ENCRYPTION_ACTIVE_KEY_ID` a `k2`. Desde ese momento lo
   nuevo se cifra con `k2`; lo viejo se sigue descifrando con `k1` (por su
   `key_id`).
3. Re-cifra las filas antiguas: descífralas con su `key_id` y vuelve a
   guardarlas (el servidor las cifra con la clave activa `k2` y actualiza
   `document_number_key_id`).
4. Solo cuando ninguna fila use ya `k1`, **retira** `k1` del keyring.

Validación: cada clave del keyring debe medir exactamente **32 bytes** o la
carga del keyring falla de forma controlada (no expone datos).
