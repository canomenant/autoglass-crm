// Corrección del TOTP, contra los vectores de prueba publicados en el RFC 6238 (Apéndice B).
//
// Esto es lo que justifica implementarlo en casa en vez de traer una dependencia: no es "parece
// que funciona", es la misma tabla que cualquier implementación conforme tiene que reproducir. Si
// esta suite pasa, un Google Authenticator generará exactamente los mismos códigos.

const { test, describe } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

const totp = require("../src/lib/totp");

// El RFC usa la semilla ASCII "12345678901234567890" (20 bytes) para HMAC-SHA1.
const SEED_ASCII = "12345678901234567890";
const SEED_B32 = totp.base32Encode(Buffer.from(SEED_ASCII, "ascii"));

describe("TOTP — vectores del RFC 6238", () => {
  test("la semilla del RFC se codifica en el base32 esperado", () => {
    assert.strictEqual(SEED_B32, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  // El RFC tabula 8 dígitos; con 6 el resultado es mod 10^6, o sea los seis últimos.
  const VECTORES = [
    { segundos: 59, ocho: "94287082" },
    { segundos: 1111111109, ocho: "07081804" },
    { segundos: 1111111111, ocho: "14050471" },
    { segundos: 1234567890, ocho: "89005924" },
    { segundos: 2000000000, ocho: "69279037" },
    { segundos: 20000000000, ocho: "65353130" },
  ];

  for (const { segundos, ocho } of VECTORES) {
    const seis = ocho.slice(-6);
    test(`T=${segundos} produce ${seis}`, () => {
      assert.strictEqual(totp.generate(SEED_B32, segundos * 1000), seis);
    });
  }

  test("el contador avanza una vez cada 30 segundos", () => {
    assert.strictEqual(totp.counterFor(59_000), 1);
    assert.strictEqual(totp.counterFor(60_000), 2);
    assert.strictEqual(totp.counterFor(89_999), 2);
    assert.strictEqual(totp.counterFor(90_000), 3);
  });
});

describe("TOTP — verificación", () => {
  const secreto = totp.generateSecret();
  const AHORA = 1_700_000_000_000;

  test("acepta el código de la ventana actual", () => {
    const codigo = totp.generate(secreto, AHORA);
    assert.notStrictEqual(totp.verify(secreto, codigo, { timeMs: AHORA }), null);
  });

  test("tolera un desfase de reloj de ±1 ventana", () => {
    const anterior = totp.generate(secreto, AHORA - 30_000);
    const siguiente = totp.generate(secreto, AHORA + 30_000);
    assert.notStrictEqual(totp.verify(secreto, anterior, { timeMs: AHORA }), null);
    assert.notStrictEqual(totp.verify(secreto, siguiente, { timeMs: AHORA }), null);
  });

  test("rechaza fuera de la ventana de tolerancia", () => {
    const viejo = totp.generate(secreto, AHORA - 120_000);
    assert.strictEqual(totp.verify(secreto, viejo, { timeMs: AHORA }), null);
  });

  test("rechaza un código de otro secreto", () => {
    const otro = totp.generateSecret();
    const codigo = totp.generate(otro, AHORA);
    // Podría coincidir por azar 1 vez entre un millón; se prueba con varias ventanas.
    let coincidencias = 0;
    for (let i = 0; i < 5; i++) {
      if (totp.verify(secreto, totp.generate(otro, AHORA + i * 30_000), { timeMs: AHORA + i * 30_000 }) !== null) coincidencias++;
    }
    assert.ok(coincidencias === 0, `un secreto ajeno no debe validar (coincidencias: ${coincidencias})`);
    assert.ok(codigo.length === 6);
  });

  test("rechaza basura sin reventar", () => {
    for (const malo of ["", null, undefined, "abc", "12345", "1234567", "  ", "０００００", { a: 1 }, []]) {
      assert.strictEqual(totp.verify(secreto, malo, { timeMs: AHORA }), null);
    }
  });

  test("devuelve el step que acertó, para poder impedir la repetición", () => {
    const step = totp.verify(secreto, totp.generate(secreto, AHORA), { timeMs: AHORA });
    assert.strictEqual(step, totp.counterFor(AHORA));
  });

  test("el secreto generado tiene 160 bits y es base32 válido", () => {
    const s = totp.generateSecret();
    assert.match(s, /^[A-Z2-7]{32}$/);
    assert.strictEqual(totp.base32Decode(s).length, 20);
  });

  test("dos secretos generados no coinciden", () => {
    const vistos = new Set(Array.from({ length: 50 }, () => totp.generateSecret()));
    assert.strictEqual(vistos.size, 50);
  });
});

describe("TOTP — base32 de ida y vuelta", () => {
  test("codificar y decodificar devuelve los mismos bytes", () => {
    for (let n = 1; n <= 40; n++) {
      const bytes = crypto.randomBytes(n);
      assert.deepStrictEqual(totp.base32Decode(totp.base32Encode(bytes)), bytes, `falla con ${n} bytes`);
    }
  });

  test("rechaza caracteres que no son base32", () => {
    assert.throws(() => totp.base32Decode("ABC!DEF"), /no es base32/);
    // 0, 1 y 8 no están en el alfabeto RFC 4648 a propósito (se confunden con O, I y B).
    assert.throws(() => totp.base32Decode("ABC0DEF"), /no es base32/);
  });
});

describe("TOTP — URI para el QR", () => {
  test("lleva secreto, emisor y parámetros que las apps esperan", () => {
    const uri = totp.otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "ana@empresa.com" });
    assert.ok(uri.startsWith("otpauth://totp/"));
    assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
    assert.match(uri, /issuer=AutoGlass\+CRM/);
    assert.match(uri, /digits=6/);
    assert.match(uri, /period=30/);
    assert.match(uri, /algorithm=SHA1/);
  });

  test("escapa la etiqueta, que lleva el correo del usuario", () => {
    const uri = totp.otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "a b/c@x.com" });
    assert.ok(!/ /.test(uri.split("?")[0]), "la etiqueta no puede llevar espacios sin escapar");
    assert.ok(!uri.split("?")[0].includes("/c@"), "ni separadores de ruta sin escapar");
  });
});
