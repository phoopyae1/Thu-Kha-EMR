import axios, { type AxiosError } from "axios";
import { fetchIntegrationEmbed } from "./patientPortal";

const DEFAULT_SERVER_URL = "https://api-qa.atenxion.ai";

type JsonRecord = Record<string, unknown>;

export interface AtenxionCredentials {
  userId: string;
  agentId?: string;
  patientId: string;
  agentchainId?: string;
  patientName?: string;
}

interface AtenxionRequestBody {
  userId: string;
  patientName: string;
  patientId: string;
  Authorization: string;
  agentId?: string;
  agentchainId?: string;

}

export type AtenxionTransactionPayload = JsonRecord;

function resolveServerUrl() {
  return import.meta.env.VITE_ATENXION_API_URL?.trim() || DEFAULT_SERVER_URL;
}

function resolveAuthorizationHeader(token?: string | null) {
  const explicitToken =
    token?.trim() || import.meta.env.VITE_ATENXION_API_TOKEN?.trim();
  if (!explicitToken) {
    return undefined;
  }
  return explicitToken.toLowerCase().startsWith("bearer ")
    ? explicitToken
    : `Bearer ${explicitToken}`;
}

function getHeaders(token?: string | null) {
  const authHeader = resolveAuthorizationHeader(token);
  return authHeader ? { Authorization: authHeader } : undefined;
}

function normalizeCredentials(
  credentials: AtenxionCredentials
): AtenxionRequestBody {
  const userId = credentials.userId.trim();
  const patientName = credentials.patientName?.trim() || userId;
  const agentId = credentials.agentId?.trim();
  const agentchainId = credentials.agentchainId?.trim();
  const patientId = credentials.patientId.trim();
  let patientToken = "";
  const stored = localStorage.getItem("patient_portal_session");
  if (stored) {
    patientToken = JSON.parse(stored).token;
  }
  const body: AtenxionRequestBody = {
    userId,
    patientName,
    patientId,
    agentId,
    agentchainId,
      Authorization: `Bearer ${patientToken}`,
    };

  if (agentId) {
    body.agentId = agentId;
  }

  if (agentchainId) {
    body.agentchainId = agentchainId;
  }

  return body;
}

function handleAxiosError(error: unknown, context: string): never {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<JsonRecord>;
    const responseData = axiosError.response?.data;
    const status = axiosError.response?.status;
    const dataText =
      typeof responseData === "string"
        ? responseData
        : JSON.stringify(responseData ?? {}, null, 2);
    const dataSnippet = dataText.slice(0, 500);
    const message = `${context} (status=${status ?? "n/a"}) ${dataSnippet}`;
    throw new Error(message);
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new Error(context);
}

export async function loginAtenxionUser(
  credentials: AtenxionCredentials,
  token?: string | null
) {
  const url = `${resolveServerUrl()}/api/post-login/user-login`;
  const resolvedToken = token || (await fetchIntegrationEmbed())?.contextKey;
  const requestBody = normalizeCredentials(credentials);
  const headers = { Authorization: `${resolvedToken}` };

  console.log("Atenxion API call:", {
    url,
    body: requestBody,
    headers,
    token: resolvedToken ? resolvedToken.substring(0, 20) + "..." : "none",
  });

  try {
    await axios.post(url, requestBody, { headers });
    return true;
  } catch (error) {
    console.error("Atenxion login failed:", error);
    return handleAxiosError(error, "Unable to log in to Atenxion");
  }
}

export async function logoutAtenxionUser(
  credentials: AtenxionCredentials,
  token?: string | null
) {
  const url = `${resolveServerUrl()}/api/post-login/user-logout`;
  const resolvedToken =  (await fetchIntegrationEmbed())?.contextKey || token;
  const body = normalizeCredentials(credentials);
  const headers = getHeaders(resolvedToken);
  try {
    console.log("Atenxion logout API call:", {
      url,
      body,
      headers,
      token: resolvedToken ? `${resolvedToken.substring(0, 16)}...` : "none",
    });
    await axios.post(url, body, { headers });
    return true;
  } catch (error) {
    console.error("Atenxion logout failed:", error);
    return handleAxiosError(error, "Unable to log out from Atenxion");
  }
}
