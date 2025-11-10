import { Elysia } from 'elysia';
import { staticPlugin } from '@elysiajs/eden';

const app = new Elysia()
  .use(staticPlugin({ assets: './ui/dist' }))
  .get('/', () => Bun.file('./ui/dist/index.html'))
  .post('/forward-auth', async ({ body }) => {
    // In a real deployment this endpoint would validate the incoming request and forward it to Catalyst.
    console.log('Received forward-auth payload', body);
    return new Response(null, { status: 204 });
  })
  .group('/api', (app) =>
    app
      .get('/organisations', () => ({
        data: [{ id: 'org-1', name: 'Acme Inc.', role: 'Owner' }]
      }))
      .get('/keys', () => ({
        data: [{ id: 'key-1', label: 'Primary', createdAt: new Date().toISOString() }]
      }))
      .post('/proxy', async ({ body }) => {
        // Simple passthrough for the UI clients; replace with authenticated Catalyst SDK calls in production.
        console.log('Proxy payload', body);
        return { data: body };
      })
  );

app.listen(8787, () => {
  console.log('Elysia forward-auth demo listening on http://localhost:8787');
});
