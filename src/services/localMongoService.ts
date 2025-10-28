import { MongoClient, Db, Collection } from 'mongodb';

export interface IntegrationEmbedDocument {
  iframeCode: string;
  contextKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsertOneResponse {
  insertedId?: string;
}

export interface FindOneResponse {
  document?: IntegrationEmbedDocument | null;
}

export class LocalMongoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalMongoError';
  }
}

let client: MongoClient | null = null;
let db: Db | null = null;

async function getDatabase(): Promise<Db> {
  if (!client) {
    const mongoUrl = process.env.MONGODB_URL;
    if (!mongoUrl) {
      throw new LocalMongoError('MONGODB_URL is not configured');
    }
    
    client = new MongoClient(mongoUrl);
    await client.connect();
  }
  
  if (!db) {
    db = client.db();
  }
  
  return db;
}

async function getCollection(): Promise<Collection<IntegrationEmbedDocument>> {
  const database = await getDatabase();
  return database.collection<IntegrationEmbedDocument>('integrationEmbeds');
}

export async function insertIntegrationEmbed(document: IntegrationEmbedDocument): Promise<InsertOneResponse> {
  try {
    const collection = await getCollection();
    const result = await collection.insertOne(document);
    return { insertedId: result.insertedId.toString() };
  } catch (error) {
    console.error('Failed to insert integration embed:', error);
    throw new LocalMongoError(`Failed to save integration embed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function fetchLatestIntegrationEmbed(): Promise<IntegrationEmbedDocument | null> {
  try {
    const collection = await getCollection();
    const document = await collection.findOne({}, { sort: { createdAt: -1 } });
    return document;
  } catch (error) {
    console.error('Failed to fetch integration embed:', error);
    throw new LocalMongoError(`Failed to fetch integration embed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function closeConnection(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
