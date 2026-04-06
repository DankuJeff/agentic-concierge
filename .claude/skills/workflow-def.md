# Skill: Defining Workflow Templates

This skill defines how to create new workflow templates for the Agentic Concierge.

## What is a Workflow Template?

A workflow template is a predefined task graph pattern for a common user request. When the Conductor recognizes a request that matches a template, it uses the template as a starting point (customizing inputs based on user context) rather than generating a task graph from scratch.

Templates improve reliability — a tested template succeeds more often than a dynamically generated graph.

## Template File Structure

```typescript
// src/workflows/templates/[name].ts

import { WorkflowTemplate, TaskStep, AutonomyLevel } from '../types';

export const TEMPLATE_VERSION = "1.0.0";

export const subscriptionAudit: WorkflowTemplate = {
  id: 'subscription-audit',
  version: TEMPLATE_VERSION,
  name: 'Subscription Audit & Optimization',
  description: 'Analyzes user subscriptions, identifies waste, and suggests optimizations',
  triggers: [
    'audit my subscriptions',
    'what am I paying for',
    'find unused subscriptions',
    'save money on subscriptions',
    'review my recurring charges',
  ],
  requiredContext: ['financial_connected', 'user_location'],
  estimatedDuration: '5-15 minutes',

  steps: [
    {
      id: 'gather_transactions',
      agent: 'finance',
      action: 'fetch_recurring_charges',
      inputs: { months: 3 },
      autonomy: AutonomyLevel.AUTO,
      dependsOn: [],
    },
    {
      id: 'categorize',
      agent: 'finance',
      action: 'categorize_subscriptions',
      inputs: { transactions: '$gather_transactions.result' },
      autonomy: AutonomyLevel.AUTO,
      dependsOn: ['gather_transactions'],
    },
    {
      id: 'detect_unused',
      agent: 'research',
      action: 'check_usage_signals',
      inputs: { subscriptions: '$categorize.result' },
      autonomy: AutonomyLevel.AUTO,
      dependsOn: ['categorize'],
    },
    {
      id: 'find_alternatives',
      agent: 'research',
      action: 'compare_alternatives',
      inputs: { active_subs: '$detect_unused.result.active' },
      autonomy: AutonomyLevel.AUTO,
      dependsOn: ['detect_unused'],
    },
    {
      id: 'build_report',
      agent: 'decision',
      action: 'subscription_optimization_report',
      inputs: {
        all_subs: '$categorize.result',
        unused: '$detect_unused.result.unused',
        alternatives: '$find_alternatives.result',
      },
      autonomy: AutonomyLevel.AUTO,
      dependsOn: ['detect_unused', 'find_alternatives'],
    },
    {
      id: 'draft_cancellations',
      agent: 'comms',
      action: 'draft_cancellation_letters',
      inputs: { to_cancel: '$build_report.result.recommended_cancellations' },
      autonomy: AutonomyLevel.AUTO,
      dependsOn: ['build_report'],
    },
    {
      id: 'user_review',
      agent: 'conductor',
      action: 'present_report_and_drafts',
      inputs: {
        report: '$build_report.result',
        drafts: '$draft_cancellations.result',
      },
      autonomy: AutonomyLevel.APPROVE,  // User must approve before any action
      dependsOn: ['build_report', 'draft_cancellations'],
    },
  ],
};
```

## Template Design Rules

1. **Dependency graph must be a DAG.** No circular dependencies. Steps that don't depend on each other should be independent (enabling parallel execution).

2. **Every step that affects the external world MUST be AutonomyLevel.APPROVE or CONFIRM.**
   - Reading data: AUTO
   - Generating drafts/reports: AUTO
   - Sending emails: APPROVE
   - Making purchases/cancellations: CONFIRM

3. **Use `$step_id.result` references for inter-step data.** The DAG executor resolves these at runtime. You can access nested fields: `$step_id.result.subscriptions[0].name`

4. **Include `requiredContext` array.** Lists what user context fields must be available before the workflow can start. If missing, the Conductor asks the user to provide them.

5. **Include `triggers` array.** Natural language phrases that should activate this template. The Conductor uses semantic matching, so these are examples, not exact matches.

6. **Keep steps atomic.** Each step should do one thing. "Research and compare" should be two steps, not one — the research might succeed but the comparison might need user input about priorities.

7. **Plan for failure at every step.** What happens if `gather_transactions` fails because Plaid is down? The workflow engine needs a fallback path (e.g., ask user to upload a bank statement manually).

## Fallback Paths

Every step that calls an external service or depends on user-provided data SHOULD define a fallback. Fallbacks are how workflows recover autonomously instead of failing.

### The Pattern

Steps that can fail should declare a fallback action:

```typescript
{
  id: 'gather_transactions',
  agent: 'finance',
  action: 'fetch_recurring_charges',
  inputs: { months: 3 },
  autonomy: AutonomyLevel.AUTO,
  dependsOn: [],
  // If this step fails or returns needs_input, Conductor inserts this fallback step:
  fallback: {
    id: 'gather_transactions_manual',
    agent: 'document',
    action: 'parse_bank_statement_upload',
    inputs: { prompt: 'Please upload a recent bank statement (PDF or CSV)' },
    autonomy: AutonomyLevel.APPROVE,  // User must provide the file
    recoveryFor: 'gather_transactions',
  },
},
```

When the Conductor detects a failed or `needs_input` step with a defined fallback, it inserts the fallback as a new DAG step with `recoveryFor` pointing at the blocked step ID. The fallback result is then injected as inputs for all steps that depended on the original.

### Rules
- **External API steps** (Plaid, Gmail, Calendar, Firecrawl) should always have a fallback.
- **Fallbacks that require user action** must be `AutonomyLevel.APPROVE` or `CONFIRM` — never `AUTO`.
- **Research-based fallbacks** (e.g., "if pricing page is down, search for cached data") can be `AUTO`.
- **Max 1 fallback per step.** If the fallback also fails, the Conductor escalates to the user or aborts the step.
- The `recoveryFor` field links the fallback task back to the original so the DAG executor routes its result correctly.

## Adding a New Template

1. Create the file in `src/workflows/templates/[name].ts`
2. Register it in `src/workflows/templates/index.ts`
3. Write integration tests in `tests/workflows/[name].test.ts`
4. Add trigger phrases to the Conductor's template matching logic
5. Update CLAUDE.md's directory structure if needed
6. Test the full workflow end-to-end with a real (or simulated) user scenario

---

> *This skill is maintained by the Lead Agent. When a workflow template fails in a new predictable way, document the failure pattern and its fallback here before the next implementation iteration.*
