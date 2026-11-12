/**
 * Erzeugt den einfügefertigen Code der chayns.codes-Bridge mit Secret und Gruppen.
 *
 *   $env:BRIDGE_SECRET="<derselbe Wert wie im Container>"
 *   $env:UAC_GROUP_TEAM="79077"; $env:UAC_GROUP_ADMIN="1"
 *   npm run build:bridge; npm run bridge:bundle
 *
 * Ausgabe: dist/bridge/bridge.chayns.js (enthält das Secret: nicht einchecken, nicht weitergeben).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const secret = process.env.BRIDGE_SECRET ?? '';
if (secret.length < 32) {
    console.error('BRIDGE_SECRET fehlt oder ist zu kurz (mind. 32 Zeichen).');
    process.exit(1);
}
const groups = [process.env.UAC_GROUP_TEAM || '79077', process.env.UAC_GROUP_ADMIN || '223675', '1']
    .join(',')
    .split(',')
    .map((g) => g.trim())
    .filter((g) => /^\d+$/.test(g))
    .join(',');

const template = readFileSync(resolve(root, 'dist/bridge/bridge.js'), 'utf8');
if (!template.includes('__BRIDGE_SECRET__') || !template.includes('__ALLOWED_GROUP_IDS__')) {
    console.error('Platzhalter nicht gefunden. Zuerst "npm run build:bridge" ausführen.');
    process.exit(1);
}
// esbuild schreibt Strings in doppelten Anführungszeichen; beide Schreibweisen ersetzen.
const output = template
    .replace(/(["'])__BRIDGE_SECRET__\1/g, JSON.stringify(secret))
    .replace(/(["'])__ALLOWED_GROUP_IDS__\1/g, JSON.stringify(groups));
if (output.includes('__BRIDGE_SECRET__') || output.includes('__ALLOWED_GROUP_IDS__')) {
    console.error('Platzhalter konnten nicht ersetzt werden.');
    process.exit(1);
}
const target = resolve(root, 'dist/bridge/bridge.chayns.js');
writeFileSync(target, output, 'utf8');
console.log(`Bridge erzeugt: ${target} (Gruppen für KI: ${groups})`);
