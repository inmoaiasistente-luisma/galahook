'use strict';
const { createClient } = require('@supabase/supabase-js');

let _client = null;

/**
 * Cliente Supabase SERVER-ONLY con la SECRET KEY (sb_secret_...).
 *
 * SOLO debe ejecutarse dentro de funciones serverless (carpeta /api).
 * NUNCA debe importarse ni exponerse en el navegador, en assets/js,
 * en HTML ni en variables NEXT_PUBLIC_*. La secret key hace bypass de
 * RLS, por lo que su filtración comprometería toda la base de datos.
 */
function getSupabase() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY no están configuradas');
  }

  _client = createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return _client;
}

module.exports = { getSupabase };
