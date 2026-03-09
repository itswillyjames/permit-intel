import { describe, it, expect } from 'vitest';
import {
  PermitStateMachine,
  ReportStateMachine,
  StageStateMachine,
  ExportStateMachine,
  InvalidTransitionError,
  type PermitStatus,
  type ReportStatus,
  type StageAttemptStatus,
  type ExportStatus,
} from '../state-machine.js';

describe('PermitStateMachine', () => {
  it('allows valid transitions', () => {
    expect(() => PermitStateMachine.assertValid('new', 'normalized')).not.toThrow();
    expect(() => PermitStateMachine.assertValid('normalized', 'prequalified')).not.toThrow();
    expect(() => PermitStateMachine.assertValid('prequalified', 'shortlisted')).not.toThrow();
    expect(() => PermitStateMachine.assertValid('new', 'rejected')).not.toThrow();
    expect(() => PermitStateMachine.assertValid('shortlisted', 'archived')).not.toThrow();
  });

  it('rejects invalid transitions', () => {
    expect(() => PermitStateMachine.assertValid('new', 'shortlisted')).toThrow(InvalidTransitionError);
    expect(() => PermitStateMachine.assertValid('rejected', 'normalized')).toThrow(InvalidTransitionError);
    expect(() => PermitStateMachine.assertValid('archived', 'new')).toThrow(InvalidTransitionError);
  });

  it('error message is informative', () => {
    try {
      PermitStateMachine.assertValid('archived', 'new');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      expect((e as InvalidTransitionError).message).toContain('archived');
      expect((e as InvalidTransitionError).message).toContain('new');
      expect((e as InvalidTransitionError).from).toBe('archived');
      expect((e as InvalidTransitionError).to).toBe('new');
    }
  });

  it('isValid returns correct booleans', () => {
    expect(PermitStateMachine.isValid('new', 'normalized')).toBe(true);
    expect(PermitStateMachine.isValid('new', 'shortlisted')).toBe(false);
  });

  it('nextStates returns correct options', () => {
    const next = PermitStateMachine.nextStates('new');
    expect(next).toContain('normalized');
    expect(next).toContain('rejected');
    expect(next).toContain('archived');
  });

  it('terminal state has no transitions', () => {
    expect(PermitStateMachine.nextStates('archived')).toHaveLength(0);
  });
});

describe('ReportStateMachine', () => {
  it('allows full happy path', () => {
    const path: ReportStatus[] = ['draft', 'queued', 'running', 'completed', 'superseded', 'archived'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => ReportStateMachine.assertValid(path[i]!, path[i + 1]!)).not.toThrow();
    }
  });

  it('allows re-run path from partial/failed', () => {
    expect(() => ReportStateMachine.assertValid('partial', 'queued')).not.toThrow();
    expect(() => ReportStateMachine.assertValid('failed', 'queued')).not.toThrow();
  });

  it('rejects skipping states', () => {
    expect(() => ReportStateMachine.assertValid('draft', 'running')).toThrow(InvalidTransitionError);
    expect(() => ReportStateMachine.assertValid('draft', 'completed')).toThrow(InvalidTransitionError);
  });
});

describe('StageStateMachine', () => {
  it('allows queued → running → succeeded', () => {
    expect(() => StageStateMachine.assertValid('queued', 'running')).not.toThrow();
    expect(() => StageStateMachine.assertValid('running', 'succeeded')).not.toThrow();
  });

  it('allows retry loop', () => {
    expect(() => StageStateMachine.assertValid('running', 'retrying')).not.toThrow();
    expect(() => StageStateMachine.assertValid('retrying', 'running')).not.toThrow();
    expect(() => StageStateMachine.assertValid('retrying', 'failed_terminal')).not.toThrow();
  });

  it('allows skipped from queued', () => {
    expect(() => StageStateMachine.assertValid('queued', 'skipped')).not.toThrow();
  });

  it('terminal states have no outgoing transitions', () => {
    expect(StageStateMachine.nextStates('succeeded')).toHaveLength(0);
    expect(StageStateMachine.nextStates('failed_terminal')).toHaveLength(0);
    expect(StageStateMachine.nextStates('skipped')).toHaveLength(0);
  });
});

describe('ExportStateMachine', () => {
  it('allows happy path', () => {
    const path: ExportStatus[] = ['draft', 'rendering', 'ready', 'delivered'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => ExportStateMachine.assertValid(path[i]!, path[i + 1]!)).not.toThrow();
    }
  });

  it('allows retry from failed', () => {
    expect(() => ExportStateMachine.assertValid('failed', 'rendering')).not.toThrow();
  });

  it('rejects invalid', () => {
    expect(() => ExportStateMachine.assertValid('delivered', 'rendering')).toThrow(InvalidTransitionError);
  });
});
