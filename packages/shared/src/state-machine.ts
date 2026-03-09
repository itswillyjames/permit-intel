/**
 * Canonical state machine implementation.
 * Each state machine is a pure function: given current state + event → new state.
 * Invalid transitions throw a typed error.
 */

export class InvalidTransitionError extends Error {
  constructor(
    public readonly machine: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`[${machine}] Invalid transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export type TransitionMap<S extends string> = Partial<Record<S, S[]>>;

export function createStateMachine<S extends string>(
  name: string,
  transitions: TransitionMap<S>,
) {
  return {
    name,
    transitions,

    /** Validate that `from → to` is allowed. Throws InvalidTransitionError if not. */
    assertValid(from: S, to: S): void {
      const allowed = transitions[from];
      if (!allowed || !allowed.includes(to)) {
        throw new InvalidTransitionError(name, from, to);
      }
    },

    /** Returns true if the transition is valid */
    isValid(from: S, to: S): boolean {
      const allowed = transitions[from];
      return Boolean(allowed && allowed.includes(to));
    },

    /** Returns all valid next states from a given state */
    nextStates(from: S): S[] {
      return transitions[from] ?? [];
    },
  };
}

// ---------------------------------------------------------------------------
// Permit state machine
// ---------------------------------------------------------------------------
export type PermitStatus = 'new' | 'normalized' | 'prequalified' | 'shortlisted' | 'rejected' | 'archived';

export const PermitStateMachine = createStateMachine<PermitStatus>('permit', {
  new: ['normalized', 'rejected', 'archived'],
  normalized: ['prequalified', 'rejected', 'archived'],
  prequalified: ['shortlisted', 'rejected', 'archived'],
  shortlisted: ['archived'],
  rejected: ['archived'],
  archived: [],
});

// ---------------------------------------------------------------------------
// Report state machine
// ---------------------------------------------------------------------------
export type ReportStatus =
  | 'draft' | 'queued' | 'running' | 'partial' | 'completed'
  | 'failed' | 'superseded' | 'archived';

export const ReportStateMachine = createStateMachine<ReportStatus>('report', {
  draft: ['queued', 'archived'],
  queued: ['running', 'failed', 'archived'],
  running: ['completed', 'partial', 'failed'],
  partial: ['queued', 'archived'],          // operator re-run
  completed: ['superseded', 'archived'],
  failed: ['queued', 'archived'],            // retry creates new version
  superseded: ['archived'],
  archived: [],
});

// ---------------------------------------------------------------------------
// Stage attempt state machine
// ---------------------------------------------------------------------------
export type StageAttemptStatus =
  | 'queued' | 'running' | 'succeeded' | 'retrying'
  | 'failed_retryable' | 'failed_terminal' | 'skipped';

export const StageStateMachine = createStateMachine<StageAttemptStatus>('stage', {
  queued: ['running', 'skipped'],
  running: ['succeeded', 'retrying', 'failed_terminal'],
  retrying: ['running', 'failed_retryable', 'failed_terminal'],
  failed_retryable: ['queued'],              // re-queued by orchestrator
  succeeded: [],
  failed_terminal: [],
  skipped: [],
});

// ---------------------------------------------------------------------------
// Export state machine
// ---------------------------------------------------------------------------
export type ExportStatus = 'draft' | 'rendering' | 'ready' | 'delivered' | 'failed';

export const ExportStateMachine = createStateMachine<ExportStatus>('export', {
  draft: ['rendering', 'failed'],
  rendering: ['ready', 'failed'],
  ready: ['delivered', 'failed'],
  delivered: [],
  failed: ['rendering'],                    // allow retry
});
