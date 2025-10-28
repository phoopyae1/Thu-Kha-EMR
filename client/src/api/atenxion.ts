import axios, { type AxiosError } from 'axios';

const DEFAULT_SERVER_URL = 'https://api-qa.brillar.ai';
const DEFAULT_AGENT_ID = 'thu-kha-emr-patient-portal';

type JsonRecord = Record<string, unknown>;

export interface AtenxionCredentials {
  userId: string;
  agentId?: string;
  patientName?: string;
}

export type AtenxionTransactionPayload = JsonRecord;

function resolveServerUrl() {
  return import.meta.env.VITE_ATENXION_API_URL?.trim() || DEFAULT_SERVER_URL;
}

export function getAtenxionAgentId() {
  return import.meta.env.VITE_ATENXION_AGENT_ID?.trim() || DEFAULT_AGENT_ID;
}

function resolveAuthorizationHeader(token?: string | null) {
  const explicitToken = token?.trim() || import.meta.env.VITE_ATENXION_API_TOKEN?.trim();
  if (!explicitToken) {
    return undefined;
  }
  return explicitToken.toLowerCase().startsWith('bearer ') ? explicitToken : `Bearer ${explicitToken}`;
}

function getHeaders(token?: string | null) {
  const authHeader = resolveAuthorizationHeader(token);
  return authHeader ? { Authorization: authHeader } : undefined;
}

function normalizeCredentials(credentials: AtenxionCredentials) {
  return {
    userId: credentials.userId,
    agentId: credentials.agentId?.trim() || getAtenxionAgentId(),
    patientName: credentials.patientName?.trim() || credentials.userId,
  } satisfies AtenxionCredentials;
}

function handleAxiosError(error: unknown, context: string): never {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<JsonRecord>;
    const responseData = axiosError.response?.data;
    const message =
      (typeof responseData === 'string' && responseData) ||
      (responseData && typeof responseData.error === 'string' && responseData.error) ||
      axiosError.message ||
      context;
    throw new Error(message);
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new Error(context);
}

export async function loginAtenxionUser(credentials: AtenxionCredentials, token?: string | null) {
  const url = `${resolveServerUrl()}/api/post-login/user-login`;
  try {
    await axios.post(url, normalizeCredentials(credentials), {
      headers: getHeaders(token),
    });
    return true;
  } catch (error) {
    console.error('Atenxion login failed:', error);
    return handleAxiosError(error, 'Unable to log in to Atenxion');
  }
}

export async function recordAtenxionTransaction(
  credentials: AtenxionCredentials,
  transaction: AtenxionTransactionPayload,
  token?: string | null,
) {
  const url = `${resolveServerUrl()}/api/post-login/new-transaction`;
  try {
    await axios.post(
      url,
      {
        ...normalizeCredentials(credentials),
        transaction,
      },
      {
        headers: getHeaders(token),
      },
    );
    return true;
  } catch (error) {
    console.error('Atenxion transaction failed:', error);
    return handleAxiosError(error, 'Unable to record Atenxion transaction');
  }
}

export async function logoutAtenxionUser(credentials: AtenxionCredentials, token?: string | null) {
  const url = `${resolveServerUrl()}/api/post-login/user-logout`;
  try {
    await axios.post(
      url,
      normalizeCredentials(credentials),
      {
        headers: getHeaders(token),
      },
    );
    return true;
  } catch (error) {
    console.error('Atenxion logout failed:', error);
    return handleAxiosError(error, 'Unable to log out from Atenxion');
  }
}
