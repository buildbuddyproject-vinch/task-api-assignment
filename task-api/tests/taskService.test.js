const taskService = require('../src/services/taskService');

describe('taskService', () => {
  beforeEach(() => {
    taskService._reset();
  });

  describe('create', () => {
    it('creates a task with defaults applied', () => {
      const task = taskService.create({ title: 'Write tests' });

      expect(task).toMatchObject({
        title: 'Write tests',
        description: '',
        status: 'todo',
        priority: 'medium',
        dueDate: null,
        assignee: null,
        completedAt: null,
      });
      expect(task.id).toEqual(expect.any(String));
      expect(task.createdAt).toEqual(expect.any(String));
    });

    it('honors provided fields instead of defaults', () => {
      const task = taskService.create({
        title: 'Ship feature',
        description: 'Details',
        status: 'in_progress',
        priority: 'high',
        dueDate: '2030-01-01T00:00:00.000Z',
      });

      expect(task).toMatchObject({
        title: 'Ship feature',
        description: 'Details',
        status: 'in_progress',
        priority: 'high',
        dueDate: '2030-01-01T00:00:00.000Z',
      });
    });

    it('assigns each task a unique id', () => {
      const a = taskService.create({ title: 'A' });
      const b = taskService.create({ title: 'B' });
      expect(a.id).not.toEqual(b.id);
    });
  });

  describe('getAll', () => {
    it('returns an empty array when there are no tasks', () => {
      expect(taskService.getAll()).toEqual([]);
    });

    it('returns a copy of the store, not a live reference', () => {
      taskService.create({ title: 'A' });
      const result = taskService.getAll();
      result.push({ id: 'fake' });
      expect(taskService.getAll()).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('returns the matching task', () => {
      const created = taskService.create({ title: 'Find me' });
      expect(taskService.findById(created.id)).toEqual(created);
    });

    it('returns undefined for an unknown id', () => {
      expect(taskService.findById('does-not-exist')).toBeUndefined();
    });
  });

  describe('getByStatus', () => {
    it('returns tasks matching the given status exactly', () => {
      taskService.create({ title: 'A', status: 'todo' });
      taskService.create({ title: 'B', status: 'done' });

      const result = taskService.getByStatus('done');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('B');
    });

    // Bug: getByStatus uses String.prototype.includes for matching, so a
    // partial value like "on" incorrectly matches status "done" (which
    // contains the substring "on"). See BUGS.md #1.
    it('BUG: incorrectly matches tasks via substring instead of exact status', () => {
      taskService.create({ title: 'A', status: 'done' });
      taskService.create({ title: 'B', status: 'todo' });

      const result = taskService.getByStatus('on');

      // Documents current (buggy) behavior: "on" is a substring of "done".
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('done');
    });
  });

  describe('getPaginated', () => {
    beforeEach(() => {
      for (let i = 1; i <= 25; i++) {
        taskService.create({ title: `Task ${i}` });
      }
    });

    it('returns the first page starting from the first item (fixed off-by-one)', () => {
      const page1 = taskService.getPaginated(1, 10);
      expect(page1).toHaveLength(10);
      expect(page1[0].title).toBe('Task 1');
      expect(page1[9].title).toBe('Task 10');
    });

    it('returns the second page starting after the first page', () => {
      const page2 = taskService.getPaginated(2, 10);
      expect(page2).toHaveLength(10);
      expect(page2[0].title).toBe('Task 11');
    });

    it('returns a partial last page', () => {
      const page3 = taskService.getPaginated(3, 10);
      expect(page3).toHaveLength(5);
      expect(page3[0].title).toBe('Task 21');
    });

    it('falls back to page 1 for a non-positive page number', () => {
      const zeroPage = taskService.getPaginated(0, 10);
      const firstPage = taskService.getPaginated(1, 10);
      expect(zeroPage).toEqual(firstPage);
    });

    it('returns an empty array past the last page', () => {
      expect(taskService.getPaginated(10, 10)).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('counts tasks by status', () => {
      taskService.create({ title: 'A', status: 'todo' });
      taskService.create({ title: 'B', status: 'todo' });
      taskService.create({ title: 'C', status: 'in_progress' });
      taskService.create({ title: 'D', status: 'done' });

      const stats = taskService.getStats();
      expect(stats).toMatchObject({ todo: 2, in_progress: 1, done: 1 });
    });

    it('returns zero counts and zero overdue when there are no tasks', () => {
      expect(taskService.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
    });

    it('counts a task with a past due date and non-done status as overdue', () => {
      taskService.create({ title: 'Late', status: 'todo', dueDate: '2000-01-01T00:00:00.000Z' });
      expect(taskService.getStats().overdue).toBe(1);
    });

    it('does not count a done task with a past due date as overdue', () => {
      const task = taskService.create({ title: 'Late but done', status: 'todo', dueDate: '2000-01-01T00:00:00.000Z' });
      taskService.completeTask(task.id);
      expect(taskService.getStats().overdue).toBe(0);
    });

    it('does not count a task with a future due date as overdue', () => {
      taskService.create({ title: 'Future', status: 'todo', dueDate: '2999-01-01T00:00:00.000Z' });
      expect(taskService.getStats().overdue).toBe(0);
    });
  });

  describe('update', () => {
    it('merges the given fields into the existing task', () => {
      const created = taskService.create({ title: 'Original' });
      const updated = taskService.update(created.id, { title: 'Updated', priority: 'high' });

      expect(updated.title).toBe('Updated');
      expect(updated.priority).toBe('high');
      expect(updated.id).toBe(created.id);
    });

    it('returns null when the task does not exist', () => {
      expect(taskService.update('missing-id', { title: 'X' })).toBeNull();
    });
  });

  describe('remove', () => {
    it('deletes an existing task and returns true', () => {
      const created = taskService.create({ title: 'Bye' });
      expect(taskService.remove(created.id)).toBe(true);
      expect(taskService.findById(created.id)).toBeUndefined();
    });

    it('returns false when the task does not exist', () => {
      expect(taskService.remove('missing-id')).toBe(false);
    });
  });

  describe('completeTask', () => {
    it('marks the task done and sets completedAt', () => {
      const created = taskService.create({ title: 'Finish me', status: 'in_progress' });
      const completed = taskService.completeTask(created.id);

      expect(completed.status).toBe('done');
      expect(completed.completedAt).toEqual(expect.any(String));
    });

    it('returns null when the task does not exist', () => {
      expect(taskService.completeTask('missing-id')).toBeNull();
    });

    // Bug: completing a task unconditionally resets priority to 'medium',
    // discarding whatever priority the task actually had. See BUGS.md #3.
    it('BUG: resets priority to medium regardless of the original priority', () => {
      const created = taskService.create({ title: 'High prio', priority: 'high' });
      const completed = taskService.completeTask(created.id);

      // Documents current (buggy) behavior.
      expect(completed.priority).toBe('medium');
    });
  });

  describe('assignTask', () => {
    it('sets the assignee on an existing task', () => {
      const created = taskService.create({ title: 'Assign me' });
      const assigned = taskService.assignTask(created.id, 'Priya');

      expect(assigned.assignee).toBe('Priya');
    });

    it('overwrites an existing assignee (reassignment)', () => {
      const created = taskService.create({ title: 'Reassign me' });
      taskService.assignTask(created.id, 'Priya');
      const reassigned = taskService.assignTask(created.id, 'Sam');

      expect(reassigned.assignee).toBe('Sam');
    });

    it('returns null when the task does not exist', () => {
      expect(taskService.assignTask('missing-id', 'Priya')).toBeNull();
    });
  });
});
