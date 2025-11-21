import axios, { type AxiosError } from "axios";
import { fetchIntegrationEmbed, fetchAdminIntegrationEmbed } from "./patientPortal";

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
  return DEFAULT_SERVER_URL;
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
  credentials: AtenxionCredentials,
  useEmrToken: boolean = false
): AtenxionRequestBody {
  const userId = credentials.userId.trim();
  const patientName = credentials.patientName?.trim() || userId;
  const agentId = credentials.agentId?.trim();
  const agentchainId = credentials.agentchainId?.trim();
  const patientId = credentials.patientId.trim();
  let authToken = "";
  
  if (useEmrToken) {
    // Use EMR access token for doctors
    const emrToken = localStorage.getItem("emr_access_token");
    if (emrToken) {
      authToken = emrToken;
    }
  } else {
    // Use patient portal token for patients
    const stored = localStorage.getItem("patient_portal_session");
    if (stored) {
      authToken = JSON.parse(stored).token;
    }
  }
  
  const body: AtenxionRequestBody = {
    userId,
    patientName,
    patientId,
    agentId,
    agentchainId,
    Authorization: `Bearer ${authToken}`,
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
  token?: string | null,
  useAdminIntegration: boolean = false
) {
  const url = `${resolveServerUrl()}/api/post-login/user-login`;
  let resolvedToken = token;
  if (!resolvedToken) {
    // Use admin integration for doctors, patient portal integration for others
    const embed = useAdminIntegration 
      ? await fetchAdminIntegrationEmbed()
      : await fetchIntegrationEmbed();
    resolvedToken = embed?.contextKey;
  }
  
  if (!resolvedToken) {
    console.warn("Atenxion login: No contextKey found in integration embed");
    // Continue anyway - the API might work without it or return a proper error
  }
  
  const requestBody = normalizeCredentials(credentials, useAdminIntegration);
  const headers = getHeaders(resolvedToken) || {};

  console.log("Atenxion login API call:", {
    url,
    body: requestBody,
    headers,
    token: resolvedToken ? resolvedToken.substring(0, 20) + "..." : "none",
    useAdminIntegration,
    hasContextKey: !!resolvedToken,
  });

  try {
    const pp = await axios.post(url, requestBody, { headers });
    console.log("Atenxion login response:", pp);
    return true;
  } catch (error) {
    console.error("Atenxion login failed:", error);
    if (axios.isAxiosError(error)) {
      console.error("Response status:", error.response?.status);
      console.error("Response data:", error.response?.data);
    }
    return handleAxiosError(error, "Unable to log in to Atenxion");
  }
}

export async function logoutAtenxionUser(
  credentials: AtenxionCredentials,
  token?: string | null,
  useAdminIntegration: boolean = false
) {
  const url = `${resolveServerUrl()}/api/post-login/user-logout`;
  let resolvedToken = token;
  if (!resolvedToken) {
    // Use admin integration for doctors, patient portal integration for others
    const embed = useAdminIntegration 
      ? await fetchAdminIntegrationEmbed()
      : await fetchIntegrationEmbed();
    resolvedToken = embed?.contextKey;
  }
  const body = normalizeCredentials(credentials, useAdminIntegration);
  const headers = getHeaders(resolvedToken) || {};
  try {
    console.log("Atenxion logout API call:", {
      url,
      body,
      headers,
      token: resolvedToken ? `${resolvedToken.substring(0, 16)}...` : "none",
      useAdminIntegration,
    });
    await axios.post(url, body, { headers });
    return true;
  } catch (error) {
    console.error("Atenxion logout failed:", error);
    return handleAxiosError(error, "Unable to log out from Atenxion");
  }
}
