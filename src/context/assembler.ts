import type { AgentName, UserProfile } from '../shared/types.js';

/**
 * Assembles a per-agent context payload from the user's profile.
 * Each agent receives only the fields relevant to its work — keeps context windows lean.
 */
export function assembleContext(
  user: UserProfile,
  agentName: AgentName,
  taskInputs: Record<string, unknown>,
): Record<string, unknown> {
  const base = { taskInputs };

  switch (agentName) {
    case 'conductor':
      // Conductor gets the full profile — it needs to route tasks appropriately
      return {
        ...base,
        userName: user.name,
        location: user.location,
        preferences: user.preferences,
        connectedServices: user.connectedServices,
      };

    case 'research':
      // Research needs location for local lookups, detail level for output depth
      return {
        ...base,
        location: user.location,
        detailLevel: user.preferences['detailLevel'],
      };

    case 'document':
      // Document agent needs userId to scope DB queries + full context for Q&A
      return {
        ...base,
        userId: user.id,
        userName: user.name,
        location: user.location,
        preferences: user.preferences,
      };

    case 'comms':
      // Communications agent needs name (salutations/sign-offs) and tone preferences
      return {
        ...base,
        userName: user.name,
        communicationTone: user.preferences['communicationTone'],
        detailLevel: user.preferences['detailLevel'],
      };

    case 'decision':
      // Decision agent needs full picture — weighted decisions require all priorities
      return {
        ...base,
        userName: user.name,
        location: user.location,
        preferences: user.preferences,
      };

    case 'finance':
      // Finance agent needs location (local costs, tax rates) and risk tolerance
      return {
        ...base,
        location: user.location,
        riskTolerance: user.preferences['riskTolerance'],
      };

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = agentName;
      return { ...base, _exhaustive };
    }
  }
}
