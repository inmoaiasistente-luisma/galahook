'use strict';

/* =========================================================
   Genera ADMIN_PASSWORD_HASH (scrypt) para el panel admin.
   ---------------------------------------------------------
   Uso:   node scripts/generate-admin-password-hash.js
   Pide la contraseña por stdin (oculta). NUNCA la imprime ni la
   guarda; imprime solo el hash para pegar en la variable de
   entorno ADMIN_PASSWORD_HASH en Vercel.

   Formato del hash:  scrypt$N$r$p$saltHex$keyHex
   ========================================================= */

const crypto = require('crypto');
const readline = require('readline');

const N = 16384, r = 8, p = 1, KEYLEN = 64;

function promptHidden(question) {
  return new Promise(function (resolve) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Silencia el eco de la contraseña (muestra '*').
    rl._writeToOutput = function (str) {
      if (str.indexOf(question) !== -1 || str === '\n' || str === '\r\n') process.stdout.write(str);
      else process.stdout.write('*');
    };
    rl.question(question, function (answer) { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async function () {
  const pw = await promptHidden('Admin password: ');
  if (!pw || pw.length < 8) {
    console.error('Password must be at least 8 characters. Nothing was written.');
    process.exit(1);
  }
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, KEYLEN, { N: N, r: r, p: p, maxmem: 64 * 1024 * 1024 });
  const hash = ['scrypt', N, r, p, salt.toString('hex'), key.toString('hex')].join('$');

  console.log('\nADMIN_PASSWORD_HASH=' + hash + '\n');
  console.log('Copy the value above into Vercel (do NOT commit it). The password itself was not stored or printed.');
})();
