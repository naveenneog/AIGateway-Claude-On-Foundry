import { readFile } from 'node:fs/promises';
import { parseNativeConfig, planNative, type ExistingPolicies } from '../src/native/plan.js';

const [configPath, existingPath] = process.argv.slice(2);
if (!configPath) {
  process.stderr.write('usage: tsx scripts/native-plan.ts <config.json> [existing-policies.json]\n');
  process.exit(2);
}
try {
  const config = parseNativeConfig(JSON.parse(await readFile(configPath, 'utf8')));
  const existing: ExistingPolicies = existingPath ? JSON.parse(await readFile(existingPath, 'utf8')) : {};
  process.stdout.write(JSON.stringify(planNative(config, existing)));
} catch (error) {
  process.stderr.write(`Invalid native-only configuration: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
