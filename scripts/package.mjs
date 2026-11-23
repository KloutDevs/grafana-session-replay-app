#!/usr/bin/env node
// Zips dist/ as <plugin-id>-<version>.zip, with a SHA-256 next to it. Unsigned.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { id } = JSON.parse(readFileSync(join(root, 'src', 'plugin.json'), 'utf8'));
const out = join(root, 'release');
const stage = join(out, 'stage');
const zip = join(out, `${id}-${version}.zip`);

rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, 'dist'), join(stage, id), { recursive: true });
execFileSync('zip', ['-qr', zip, id], { cwd: stage });
rmSync(stage, { recursive: true, force: true });

const sum = createHash('sha256').update(readFileSync(zip)).digest('hex');
writeFileSync(`${zip}.sha256`, `${sum}  ${id}-${version}.zip\n`);
console.log(`${zip}\nsha256 ${sum}`);
