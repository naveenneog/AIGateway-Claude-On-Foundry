import { z } from 'zod';
import { GatewayError } from './errors.js';

const name = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const names = z.array(name).min(1).max(1000);
const identifiers = z.array(z.string().min(1).max(200)).min(1).max(1000);
const dollars = z.number().finite().nonnegative().max(1_000_000);
const modelSchema = z.strictObject({
  deployment: name,
  contextTokens: z.number().int().min(1).max(2_000_000),
  maxOutputTokens: z.number().int().min(1).max(200_000),
  inputUsdPerMillion: dollars,
  outputUsdPerMillion: dollars,
  cacheReadUsdPerMillion: dollars,
  cacheWriteUsdPerMillion: dollars
});
const unitSchema = z.strictObject({
  groups: identifiers,
  models: names,
  clients: names,
  monthlyBudgetUsd: dollars
});
const outputTokens = z.number().int().min(1).max(200000);
const combinationSchema = z.strictObject({
  monthlyBudgetUsd: dollars.optional(),
  userMonthlyBudgetUsd: dollars.optional(),
  models: names.optional(),
  clients: names.optional(),
  maxOutputTokens: outputTokens.optional()
});
const schema = z.strictObject({
  monthlyBudgetUsd: dollars,
  models: z.record(name, modelSchema),
  clients: z.record(name, z.strictObject({ applicationIds: identifiers })),
  businessUnits: z.record(name, unitSchema.extend({
    tiers: names.optional(),
    tierOverrides: z.record(name, combinationSchema).optional()
  })),
  tiers: z.record(name, unitSchema.extend({ userMonthlyBudgetUsd: dollars, maxOutputTokens: outputTokens.optional() }))
}).superRefine((value, ctx) => {
  for (const key of ['models', 'clients', 'businessUnits', 'tiers'] as const) {
    if (!Object.keys(value[key]).length) ctx.addIssue({ code: 'custom', message: `${key} must not be empty` });
  }
  for (const unit of [...Object.values(value.businessUnits), ...Object.values(value.tiers)]) {
    if (unit.models.some((id) => !Object.hasOwn(value.models, id)) ||
        unit.clients.some((id) => !Object.hasOwn(value.clients, id))) {
      ctx.addIssue({ code: 'custom', message: 'Unknown model or client reference' });
    }
    for (const unit of Object.values(value.businessUnits)) {
      if (unit.tiers?.some((id) => !Object.hasOwn(value.tiers, id)) ||
          Object.keys(unit.tierOverrides ?? {}).some((id) => !Object.hasOwn(value.tiers, id))) {
        ctx.addIssue({ code: 'custom', message: 'Unknown tier reference' });
      }
      for (const override of Object.values(unit.tierOverrides ?? {})) {
        if (override.models?.some((id) => !Object.hasOwn(value.models, id)) ||
            override.clients?.some((id) => !Object.hasOwn(value.clients, id))) {
          ctx.addIssue({ code: 'custom', message: 'Unknown combination model or client reference' });
        }
      }
    }
  }
  const applications = Object.values(value.clients).flatMap((client) => client.applicationIds);
  if (new Set(applications).size !== applications.length) {
    ctx.addIssue({ code: 'custom', message: 'Application IDs must identify exactly one client family' });
  }
});

export type Policy = z.infer<typeof schema>;
export type Model = z.infer<typeof modelSchema>;
export type Entitlement = { bu: string; tier: string; client: string; model: string };

export function parsePolicy(value: unknown): Policy {
  return schema.parse(value);
}

export function resolveEntitlement(policy: Policy, groups: string[], applicationId: string, model: string): Entitlement {
  const membership = new Set(groups);
  const matches = (units: Policy['businessUnits']) =>
    Object.entries(units).filter(([, unit]) => unit.groups.some((group) => membership.has(group)));
  const bus = matches(policy.businessUnits);
  const tiers = matches(policy.tiers);
  if (!bus.length || !tiers.length) throw new GatewayError(403, 'membership_required');
  if (bus.length !== 1 || tiers.length !== 1) throw new GatewayError(403, 'ambiguous_membership');
  const [bu, unit] = bus[0]!;
  const [tier, tierPolicy] = tiers[0]!;
  if (unit.tiers && !unit.tiers.includes(tier)) throw new GatewayError(403, 'tier_not_allowed');
  const combination = unit.tierOverrides?.[tier];
  const client = Object.entries(policy.clients).find(([, value]) => value.applicationIds.includes(applicationId))?.[0];
  if (!client || !unit.clients.includes(client) || !tierPolicy.clients.includes(client) ||
      (combination?.clients && !combination.clients.includes(client))) {
    throw new GatewayError(403, 'client_not_allowed');
  }
  if (!Object.hasOwn(policy.models, model) || !unit.models.includes(model) || !tierPolicy.models.includes(model) ||
      (combination?.models && !combination.models.includes(model))) {
    throw new GatewayError(403, 'model_not_allowed');
  }
  return { bu, tier, client, model };
}

export function entitlementLimits(policy: Policy, entitlement: Entitlement) {
  const tier = policy.tiers[entitlement.tier]!;
  const combination = policy.businessUnits[entitlement.bu]!.tierOverrides?.[entitlement.tier];
  return {
    monthlyBudgetUsd: combination?.monthlyBudgetUsd ?? tier.monthlyBudgetUsd,
    userMonthlyBudgetUsd: combination?.userMonthlyBudgetUsd ?? tier.userMonthlyBudgetUsd,
    maxOutputTokens: Math.min(policy.models[entitlement.model]!.maxOutputTokens, tier.maxOutputTokens ?? 200000, combination?.maxOutputTokens ?? 200000)
  };
}
