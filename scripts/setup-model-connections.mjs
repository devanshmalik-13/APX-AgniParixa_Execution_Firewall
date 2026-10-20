import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const target = '.dev.vars';
if (spawnSync('git', ['check-ignore', '--quiet', target], { stdio: 'ignore' }).status !== 0) throw new Error('Runtime settings must be ignored by Git. No secret written.');
if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error('Runtime settings cannot be a symbolic link. No secret written.');
const existing = existsSync(target) ? readFileSync(target, 'utf8') : '';
if (!/^MODEL_CONNECTION_SECRET=\s*[a-f0-9]{64}\s*$/im.test(existing)) {
 if (/^MODEL_CONNECTION_SECRET=/m.test(existing)) throw new Error('Existing encryption setting needs manual review. No secrets changed.');
 writeFileSync(target, existing.trimEnd()+'\nMODEL_CONNECTION_SECRET='+randomBytes(32).toString('hex')+'\n', {mode:0o600});
}
console.log('Local connection encryption configured in ignored runtime settings.');
