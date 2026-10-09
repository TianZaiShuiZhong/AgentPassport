import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { hashJson } from '../sdk/index.mjs';
export function encryptMemory(key, payload, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex'),
    aad,
  };
}
export function decryptMemory(key, envelope, expectedAad) {
  if (envelope.aad !== expectedAad || envelope.version !== 1)
    throw new Error('Memory context mismatch');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
  decipher.setAAD(Buffer.from(expectedAad));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(envelope.data, 'hex')), decipher.final()]).toString(
      'utf8',
    ),
  );
}
export const envelopeHash = (envelope) => hashJson(envelope);
