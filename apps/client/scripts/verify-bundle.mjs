#!/usr/bin/env node
/**
 * Refuse to ship a client that cannot reach its own API.
 *
 * A build made without the untracked .env once produced a bundle where
 * API_BASE was '', which every guard in App.tsx reads as "no backend": no
 * session restore, no sign-in, no identities, no sign-out, no delete account,
 * and demo rows seeded over the top. It served a 200 and looked fine.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const fail = (m) => { console.error(`verify-bundle: ${m}`); process.exitCode = 1; };

const assets = join(dist, 'assets');
const js = readdirSync(assets).filter((f) => f.endsWith('.js'));
if (js.length === 0) fail('no JS emitted');

const bundle = js.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');

// Either an explicit base was inlined, or the app falls back to its own origin.
if (!/location\.origin/.test(bundle) && !/https?:\/\/[^"']+/.test(bundle)) {
  fail('bundle has no API base — the app would run with no backend at all');
}

// Sign-in is dead without the OAuth client ID: the button renders disabled
// and says nothing about why.
if (!/\.apps\.googleusercontent\.com/.test(bundle)) {
  fail('bundle has no Google client ID — the sign-in button would be disabled');
}

// index.html must point at a file that exists, or the page loads to nothing.
const html = readFileSync(join(dist, 'index.html'), 'utf8');
for (const ref of [...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map((m) => m[1])) {
  if (!readdirSync(assets).includes(ref)) fail(`index.html references missing asset ${ref}`);
}

if (!process.exitCode) console.log(`verify-bundle: ok (${js.join(', ')})`);
