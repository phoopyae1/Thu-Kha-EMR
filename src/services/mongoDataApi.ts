export interface IntegrationEmbedDocument {
  iframeCode: string;
  contextKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsertOneResponse {
  insertedId?: string;
}

export class MongoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MongoConfigurationError';
  }
}

export class MongoDataApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'MongoDataApiError';
    this.status = status;
    this.details = details;
  }
}

function getBaseRequestInit(): RequestInit {
  const apiKey = process.env.MONGODB_DATA_API_KEY;

  if (!apiKey) {
    throw new MongoConfigurationError('MONGODB_DATA_API_KEY is not configured');
  }

  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
  } satisfies RequestInit;
}

function buildPayload(document: IntegrationEmbedDocument) {
  const dataSource = process.env.MONGODB_DATA_SOURCE;
  const database = process.env.MONGODB_DATA_DATABASE;
  const collection = process.env.MONGODB_DATA_COLLECTION ?? 'integrationEmbeds';

  if (!dataSource) {
    throw new MongoConfigurationError('MONGODB_DATA_SOURCE is not configured');
  }

  if (!database) {
    throw new MongoConfigurationError('MONGODB_DATA_DATABASE is not configured');
  }

  return {
    dataSource,
    database,
    collection,
    document,
  };
}

export async function insertIntegrationEmbed(document: IntegrationEmbedDocument) {
  const endpoint = process.env.MONGODB_DATA_API_URL;

  if (!endpoint) {
    console.warn('MongoDB Data API not configured - skipping integration embed storage');
    return { insertedId: 'mock-id' };
  }

  const baseInit = getBaseRequestInit();
  const payload = buildPayload(document);
  const response = await fetch(endpoint, {
    ...baseInit,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    let details: unknown;

    try {
      details = text ? JSON.parse(text) : undefined;
    } catch (error) {
      details = text;
    }

    throw new MongoDataApiError('MongoDB Data API request failed', response.status, details);
  }

  const result = (await response.json()) as InsertOneResponse;

  return result;
}
