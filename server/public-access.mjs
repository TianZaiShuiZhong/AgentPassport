import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { root } from '../scripts/compile.mjs';
import { readJson } from './storage.mjs';
export const publicSettingsFile = () =>
  process.env.PUBLIC_CONFIG_FILE ||
  path.join(process.env.DATA_DIR || path.join(root, '.data'), 'public-access.json');
export function trustedPublicRequest(req) {
  const settings = readJson(publicSettingsFile(), null);
  const a = Buffer.from(req.get('x-public-gateway') || ''),
    b = Buffer.from(settings?.gatewaySecret || '');
  return Boolean(
    b.length &&
    a.length === b.length &&
    timingSafeEqual(a, b) &&
    settings.origin &&
    req.get('origin') === settings.origin,
  );
}
