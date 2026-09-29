const { validateCreateTask, validateUpdateTask, validateAssignTask } = require('../src/utils/validators');

describe('validateCreateTask', () => {
  it('passes for a minimal valid body', () => {
    expect(validateCreateTask({ title: 'Do the thing' })).toBeNull();
  });

  it('rejects a missing title', () => {
    expect(validateCreateTask({})).toMatch(/title is required/);
  });

  it('rejects an empty/whitespace-only title', () => {
    expect(validateCreateTask({ title: '   ' })).toMatch(/title is required/);
  });

  it('rejects a non-string title', () => {
    expect(validateCreateTask({ title: 123 })).toMatch(/title is required/);
  });

  it('rejects an invalid status', () => {
    expect(validateCreateTask({ title: 'X', status: 'archived' })).toMatch(/status must be one of/);
  });

  it('rejects an invalid priority', () => {
    expect(validateCreateTask({ title: 'X', priority: 'urgent' })).toMatch(/priority must be one of/);
  });

  it('rejects an unparsable dueDate', () => {
    expect(validateCreateTask({ title: 'X', dueDate: 'not-a-date' })).toMatch(/dueDate must be a valid/);
  });

  it('accepts a valid dueDate', () => {
    expect(validateCreateTask({ title: 'X', dueDate: '2030-01-01T00:00:00.000Z' })).toBeNull();
  });
});

describe('validateUpdateTask', () => {
  it('passes for an empty body (no changes)', () => {
    expect(validateUpdateTask({})).toBeNull();
  });

  it('rejects an empty title when title is provided', () => {
    expect(validateUpdateTask({ title: '' })).toMatch(/title must be a non-empty string/);
  });

  it('rejects a non-string title', () => {
    expect(validateUpdateTask({ title: 42 })).toMatch(/title must be a non-empty string/);
  });

  it('rejects an invalid status', () => {
    expect(validateUpdateTask({ status: 'archived' })).toMatch(/status must be one of/);
  });

  it('rejects an invalid priority', () => {
    expect(validateUpdateTask({ priority: 'urgent' })).toMatch(/priority must be one of/);
  });

  it('rejects an unparsable dueDate', () => {
    expect(validateUpdateTask({ dueDate: 'not-a-date' })).toMatch(/dueDate must be a valid/);
  });
});

describe('validateAssignTask', () => {
  it('passes for a valid assignee', () => {
    expect(validateAssignTask({ assignee: 'Priya' })).toBeNull();
  });

  it('rejects a missing assignee', () => {
    expect(validateAssignTask({})).toMatch(/assignee is required/);
  });

  it('rejects an empty string assignee', () => {
    expect(validateAssignTask({ assignee: '' })).toMatch(/assignee is required/);
  });

  it('rejects a whitespace-only assignee', () => {
    expect(validateAssignTask({ assignee: '   ' })).toMatch(/assignee is required/);
  });

  it('rejects a non-string assignee', () => {
    expect(validateAssignTask({ assignee: 42 })).toMatch(/assignee is required/);
  });
});
