import { generateKeyPairSync, sign } from 'node:crypto';

// A self-signed certificate for localhost, built with node:crypto only.
// It is a minimal X.509 v1 certificate in DER; no browser trusts it.
const len = (n) => (n < 128 ? Buffer.from([n])
  : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const tlv = (tag, ...parts) => { const b = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(b.length), b]); };
const seq = (...p) => tlv(0x30, ...p);
const oid = (s) => {
  const [a, b, ...rest] = s.split('.').map(Number);
  const out = [40 * a + b];
  for (const v of rest) {
    const bytes = [v & 127];
    for (let x = v >> 7; x; x >>= 7) bytes.unshift((x & 127) | 128);
    out.push(...bytes);
  }
  return tlv(0x06, Buffer.from(out));
};
const time = (d) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const name = seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from('localhost')))));
const alg = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));

export function selfSigned() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Date.now();
  const tbs = seq(tlv(0x02, Buffer.from([1])), alg, name,
    seq(time(new Date(now - 864e5)), time(new Date(now + 864e5))), name,
    publicKey.export({ type: 'spki', format: 'der' }));
  const sig = sign('sha256', tbs, privateKey);
  const der = seq(tbs, alg, tlv(0x03, Buffer.from([0]), sig));
  const b64 = der.toString('base64').match(/.{1,64}/g).join('\n');
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`,
  };
}
