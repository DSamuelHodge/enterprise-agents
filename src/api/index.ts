import { Hono } from 'hono';
import type { ApiEnv } from './middleware.ts';
import { requireUser } from './middleware.ts';
import auth from './auth.ts';
import core from './core.ts';
import agents from './agents.ts';
import tasks from './tasks.ts';
import data from './data.ts';
import channels from './channels.ts';

const api = new Hono<ApiEnv>();

api.route('/auth', auth);
api.get('/slack/oauth/callback', (c) => channels.fetch(c.req.raw, c.env));

api.use('*', requireUser);
api.route('/', core);
api.route('/', agents);
api.route('/', tasks);
api.route('/', data);
api.route('/', channels);

export default api;
