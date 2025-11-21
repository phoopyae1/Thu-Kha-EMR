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
    // Use same MongoDB server as patient portal
    const mongoUrl = process.env.MONGODB_URL;
    if (!mongoUrl) {
      throw new LocalMongoError('MONGODB_URL is not configured');
    }
    
    client = new MongoClient(mongoUrl);
    await client.connect();
  }
  
  if (!db) {
    // Use DemoHealthcare database with separate collection
    db = client.db('DemoHealthcare');
  }
  
  return db;
}

async function getCollection(collectionName: string): Promise<Collection<IntegrationEmbedDocument>> {
  const database = await getDatabase();
  return database.collection<IntegrationEmbedDocument>(collectionName);
}

// Patient portal integration - uses integrationEmbeds collection
export async function insertIntegrationEmbed(document: IntegrationEmbedDocument): Promise<InsertOneResponse> {
  try {
    const collection = await getCollection('integrationEmbeds');
    // Use upsert to update existing document or insert new one
    // Find the latest document to get its _id, or use a fixed filter
    const existing = await collection.findOne({}, { sort: { createdAt: -1 } });
    
    if (existing && existing._id) {
      // Update existing document
      await collection.updateOne(
        { _id: existing._id },
        { 
          $set: {
            iframeCode: document.iframeCode,
            contextKey: document.contextKey,
            updatedAt: document.updatedAt,
            // Keep original createdAt
            createdAt: existing.createdAt || document.createdAt,
          }
        }
      );
      return { insertedId: existing._id.toString() };
    } else {
      // Insert new document
      const result = await collection.insertOne(document);
      return { insertedId: result.insertedId.toString() };
    }
  } catch (error) {
    console.error('Failed to insert integration embed:', error);
    throw new LocalMongoError(`Failed to save integration embed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function fetchLatestIntegrationEmbed(): Promise<IntegrationEmbedDocument | null> {
  try {
    const collection = await getCollection('integrationEmbeds');
    const document = await collection.findOne({}, { sort: { createdAt: -1 } });
    return document;
  } catch (error) {
    console.error('Failed to fetch integration embed:', error);
    throw new LocalMongoError(`Failed to fetch integration embed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Admin integration - uses adminIntegrationSettings collection
export async function insertAdminIntegrationEmbed(document: IntegrationEmbedDocument): Promise<InsertOneResponse> {
  try {
    const collection = await getCollection('adminIntegrationSettings');
    // Use upsert to update existing document or insert new one
    const existing = await collection.findOne({}, { sort: { createdAt: -1 } });
    
    if (existing && existing._id) {
      // Update existing document
      await collection.updateOne(
        { _id: existing._id },
        { 
          $set: {
            iframeCode: document.iframeCode,
            contextKey: document.contextKey,
            updatedAt: document.updatedAt,
            // Keep original createdAt
            createdAt: existing.createdAt || document.createdAt,
          }
        }
      );
      return { insertedId: existing._id.toString() };
    } else {
      // Insert new document
      const result = await collection.insertOne(document);
      return { insertedId: result.insertedId.toString() };
    }
  } catch (error) {
    console.error('Failed to insert admin integration embed:', error);
    throw new LocalMongoError(`Failed to save admin integration embed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function fetchLatestAdminIntegrationEmbed(): Promise<IntegrationEmbedDocument | null> {
  try {
    const collection = await getCollection('adminIntegrationSettings');
    const document = await collection.findOne({}, { sort: { createdAt: -1 } });
    return document;
  } catch (error) {
    console.error('Failed to fetch admin integration embed:', error);
    throw new LocalMongoError(`Failed to fetch admin integration embed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function closeConnection(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
