const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

const createTask = (overrides = {}) =>
  request(app)
    .post('/tasks')
    .send({ title: 'Default task', ...overrides });

beforeEach(() => {
  taskService._reset();
});

describe('POST /tasks', () => {
  it('creates a task and returns 201 with the created task', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Write tests', priority: 'high' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Write tests',
      priority: 'high',
      status: 'todo',
      description: '',
      dueDate: null,
      assignee: null,
      completedAt: null,
    });
    expect(res.body.id).toEqual(expect.any(String));
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app).post('/tasks').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title is required/);
  });

  it('returns 400 for an invalid status', async () => {
    const res = await createTask({ status: 'archived' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be one of/);
  });

  it('returns 400 for an invalid priority', async () => {
    const res = await createTask({ priority: 'urgent' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/priority must be one of/);
  });

  it('returns 400 for an invalid dueDate', async () => {
    const res = await createTask({ dueDate: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dueDate must be a valid/);
  });
});

describe('malformed request body', () => {
  // Bug: express.json() attaches a 400 status to the parse error, but the
  // error middleware in src/app.js ignores err.status and always responds
  // 500. A client sending malformed JSON gets "Internal server error"
  // instead of a 400 Bad Request. See BUGS.md #4.
  it('BUG: responds 500 instead of 400 for invalid JSON', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Content-Type', 'application/json')
      .send('{ invalid json');

    // Documents current (buggy) behavior.
    expect(res.status).toBe(500);
  });
});

describe('GET /tasks', () => {
  it('returns an empty array when there are no tasks', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all created tasks', async () => {
    await createTask({ title: 'A' });
    await createTask({ title: 'B' });

    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('filters by status using an exact match', async () => {
    await createTask({ title: 'A', status: 'todo' });
    await createTask({ title: 'B', status: 'done' });

    const res = await request(app).get('/tasks?status=done');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('B');
  });

  it('paginates results, returning the first `limit` items on page 1', async () => {
    for (let i = 1; i <= 15; i++) {
      await createTask({ title: `Task ${i}` });
    }

    const res = await request(app).get('/tasks?page=1&limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(10);
    expect(res.body[0].title).toBe('Task 1');
  });

  it('returns the next slice of results on page 2', async () => {
    for (let i = 1; i <= 15; i++) {
      await createTask({ title: `Task ${i}` });
    }

    const res = await request(app).get('/tasks?page=2&limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    expect(res.body[0].title).toBe('Task 11');
  });
});

describe('GET /tasks/stats', () => {
  it('returns zero counts when there are no tasks', async () => {
    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  it('returns counts by status and overdue count', async () => {
    await createTask({ title: 'A', status: 'todo' });
    await createTask({ title: 'B', status: 'done' });
    await createTask({ title: 'C', status: 'todo', dueDate: '2000-01-01T00:00:00.000Z' });

    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 2, in_progress: 0, done: 1, overdue: 1 });
  });
});

describe('PUT /tasks/:id', () => {
  it('updates fields on an existing task', async () => {
    const created = await createTask({ title: 'Original' });

    const res = await request(app)
      .put(`/tasks/${created.body.id}`)
      .send({ title: 'Updated', priority: 'high' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated');
    expect(res.body.priority).toBe('high');
  });

  it('returns 404 for a non-existent task', async () => {
    const res = await request(app).put('/tasks/does-not-exist').send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid update body', async () => {
    const created = await createTask();
    const res = await request(app)
      .put(`/tasks/${created.body.id}`)
      .send({ status: 'archived' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /tasks/:id', () => {
  it('deletes an existing task and returns 204', async () => {
    const created = await createTask();

    const res = await request(app).delete(`/tasks/${created.body.id}`);
    expect(res.status).toBe(204);

    const getRes = await request(app).get('/tasks');
    expect(getRes.body).toHaveLength(0);
  });

  it('returns 404 for a non-existent task', async () => {
    const res = await request(app).delete('/tasks/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /tasks/:id/complete', () => {
  it('marks an existing task as done and sets completedAt', async () => {
    const created = await createTask({ status: 'in_progress' });

    const res = await request(app).patch(`/tasks/${created.body.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.completedAt).toEqual(expect.any(String));
  });

  it('returns 404 for a non-existent task', async () => {
    const res = await request(app).patch('/tasks/does-not-exist/complete');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /tasks/:id/assign', () => {
  it('assigns a task to a user and returns the updated task', async () => {
    const created = await createTask();

    const res = await request(app)
      .patch(`/tasks/${created.body.id}/assign`)
      .send({ assignee: 'Priya' });

    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Priya');
    expect(res.body.id).toBe(created.body.id);
  });

  it('returns 404 for a non-existent task', async () => {
    const res = await request(app)
      .patch('/tasks/does-not-exist/assign')
      .send({ assignee: 'Priya' });

    expect(res.status).toBe(404);
  });

  it('returns 400 when assignee is missing', async () => {
    const created = await createTask();

    const res = await request(app).patch(`/tasks/${created.body.id}/assign`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/assignee is required/);
  });

  it('returns 400 when assignee is an empty string', async () => {
    const created = await createTask();

    const res = await request(app)
      .patch(`/tasks/${created.body.id}/assign`)
      .send({ assignee: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/assignee is required/);
  });

  it('returns 400 when assignee is whitespace only', async () => {
    const created = await createTask();

    const res = await request(app)
      .patch(`/tasks/${created.body.id}/assign`)
      .send({ assignee: '   ' });

    expect(res.status).toBe(400);
  });

  it('allows reassigning a task that already has an assignee', async () => {
    const created = await createTask();

    await request(app).patch(`/tasks/${created.body.id}/assign`).send({ assignee: 'Priya' });
    const res = await request(app)
      .patch(`/tasks/${created.body.id}/assign`)
      .send({ assignee: 'Sam' });

    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Sam');
  });
});
