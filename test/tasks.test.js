import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, login } from './helpers.js';

test('task add/edit/complete/delete round-trip with done-last sorting', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    const a = await (await s.post('/api/tasks', { text: 'Email orientation vendors' })).json();
    const b = await (await s.post('/api/tasks', { text: 'Draft FAFSA reminder' })).json();

    await s.put(`/api/tasks/${b.id}`, { done: true });
    let { tasks } = await (await s.get('/api/tasks')).json();
    assert.equal(tasks[0].id, a.id, 'open task sorts first');
    assert.equal(tasks.at(-1).id, b.id, 'completed task sorts last');
    assert.equal(tasks.at(-1).done, 1);

    await s.put(`/api/tasks/${a.id}`, { text: 'Email orientation vendors today' });
    ({ tasks } = await (await s.get('/api/tasks')).json());
    assert.equal(tasks[0].text, 'Email orientation vendors today');

    assert.equal((await s.del(`/api/tasks/${a.id}`)).status, 200);
    ({ tasks } = await (await s.get('/api/tasks')).json());
    assert.equal(tasks.length, 1);

    assert.equal((await s.post('/api/tasks', { text: '   ' })).status, 400);
    assert.equal((await s.del('/api/tasks/999')).status, 404);
  } finally {
    server.close();
  }
});
