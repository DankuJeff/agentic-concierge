/**
 * BaseAgent — abstract base class for all specialist agents.
 * Every specialist (research, document, comms, decision, finance) extends this.
 */

import { AgentTaskOutputSchema, type AgentTaskInput, type AgentTaskOutput } from '../shared/types.js';
import { childLogger } from '../shared/logger.js';

export abstract class BaseAgent {
  abstract readonly agentName: string;

  protected log = childLogger({ module: 'base-agent' });

  /**
   * Execute a task. Implemented by each specialist.
   * Must return a valid AgentTaskOutput — validated before returning to the Conductor.
   */
  abstract run(task: AgentTaskInput): Promise<AgentTaskOutput>;

  /**
   * Validate output before it leaves the agent.
   * Catches schema drift early rather than letting it corrupt workflow state.
   */
  protected validateOutput(raw: unknown): AgentTaskOutput {
    const result = AgentTaskOutputSchema.safeParse(raw);
    if (!result.success) {
      this.log.error({ issues: result.error.issues }, 'Agent output failed schema validation');
      return {
        taskId: (raw as Record<string, unknown>)?.['taskId'] as string ?? 'unknown',
        status: 'failed',
        sources: [],
        error: `Output schema validation failed: ${result.error.message}`,
      };
    }
    return result.data;
  }
}
