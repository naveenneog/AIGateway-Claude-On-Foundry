export function policyFixture() {
  return {
    monthlyBudgetUsd: 1000,
    models: {
      sonnet: {
        deployment: 'test-sonnet', contextTokens: 200000, maxOutputTokens: 4096,
        inputUsdPerMillion: 3, outputUsdPerMillion: 15,
        cacheReadUsdPerMillion: 0.3, cacheWriteUsdPerMillion: 6
      }
    },
    clients: {
      cli: { applicationIds: ['cli-app'] },
      desktop: { applicationIds: ['desktop-app'] }
    },
    businessUnits: {
      finance: { groups: ['group-finance'], models: ['sonnet'], clients: ['cli'], monthlyBudgetUsd: 500 }
    } as Record<string, { groups: string[]; models: string[]; clients: string[]; monthlyBudgetUsd: number }>,
    tiers: {
      research: { groups: ['group-research'], models: ['sonnet'], clients: ['cli', 'desktop'], monthlyBudgetUsd: 200, userMonthlyBudgetUsd: 20 }
    } as Record<string, { groups: string[]; models: string[]; clients: string[]; monthlyBudgetUsd: number; userMonthlyBudgetUsd: number }>
  };
}
