import { jest } from '@jest/globals';
import request from 'supertest';

import { app } from '../src/index';

describe('Patient portal integration embeds', () => {
  const envKeys = [
    'MONGODB_DATA_API_KEY',
    'MONGODB_DATA_SOURCE',
    'MONGODB_DATA_DATABASE',
    'MONGODB_DATA_COLLECTION',
    'MONGODB_DATA_API_URL',
    'MONGODB_DATA_API_FIND_URL',
  ] as const;

  const originalEnv: Record<(typeof envKeys)[number], string | undefined> = {
    MONGODB_DATA_API_KEY: process.env.MONGODB_DATA_API_KEY,
    MONGODB_DATA_SOURCE: process.env.MONGODB_DATA_SOURCE,
    MONGODB_DATA_DATABASE: process.env.MONGODB_DATA_DATABASE,
    MONGODB_DATA_COLLECTION: process.env.MONGODB_DATA_COLLECTION,
    MONGODB_DATA_API_URL: process.env.MONGODB_DATA_API_URL,
  };

  beforeEach(() => {
    process.env.MONGODB_DATA_API_KEY = 'test-api-key';
    process.env.MONGODB_DATA_SOURCE = 'Cluster0';
    process.env.MONGODB_DATA_DATABASE = 'thu-kha';
    process.env.MONGODB_DATA_COLLECTION = 'integrationEmbeds';
    process.env.MONGODB_DATA_API_URL = 'https://data.mongodb-api.com/app/data-abc/endpoint/data/v1/action/insertOne';
    process.env.MONGODB_DATA_API_FIND_URL = 'https://data.mongodb-api.com/app/data-abc/endpoint/data/v1/action/findOne';
  });

  afterEach(() => {
    jest.restoreAllMocks();

    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('persists iframe code and context key to MongoDB Data API', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({ insertedId: 'mongo-id-123' }),
      } as never);

    const res = await request(app)
      .post('/api/patient-portal/integration-embeds')
      .send({
        iframeCode: '<iframe src="https://portal.test/embed"></iframe>',
        contextKey: 'CTX-abc-123',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('mongo-id-123');

    expect(fetchMock).toHaveBeenCalledWith(
      process.env.MONGODB_DATA_API_URL,
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(((init as Record<string, unknown>).body as string) ?? '{}');
    expect(payload.document.contextKey).toBe('CTX-abc-123');
    expect(payload.document.iframeCode).toContain('https://portal.test/embed');
  });

  it('returns 503 when MongoDB configuration is missing', async () => {
    delete process.env.MONGODB_DATA_API_KEY;
    const fetchSpy = jest.spyOn(global, 'fetch');

    const res = await request(app)
      .post('/api/patient-portal/integration-embeds')
      .send({
        iframeCode: '<iframe src="https://portal.test/embed"></iframe>',
        contextKey: 'CTX-missing-config',
      });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('MONGODB_DATA_API_KEY');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('loads the most recent integration embed', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          document: {
            iframeCode: '<iframe src="https://portal.example.com/embed" data-context-key="{{contextKey}}"></iframe>',
            contextKey: 'CTX-loaded',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        }),
      } as never);

    const res = await request(app).get('/api/patient-portal/integration-embeds/latest');

    expect(res.status).toBe(200);
    expect(res.body.embed.contextKey).toBe('CTX-loaded');
    expect(fetchMock).toHaveBeenCalledWith(
      process.env.MONGODB_DATA_API_FIND_URL,
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(((init as Record<string, unknown>).body as string) ?? '{}');
    expect(payload.sort).toEqual({ createdAt: -1 });
  });

  it('returns 404 when no integration embed is configured', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as never);

    const res = await request(app).get('/api/patient-portal/integration-embeds/latest');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No integration embed configured');
  });
});
