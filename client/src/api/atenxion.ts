import axios, { type AxiosError } from "axios";
import {
  fetchIntegrationEmbed,
  fetchAdminIntegrationEmbed,
} from "./patientPortal";
import { getAccessToken } from "./http";

const DEFAULT_SERVER_URL = "https://backend.atenxion.ai";

type JsonRecord = Record<string, unknown>;

export interface AtenxionCredentials {
  userId: string;
  agentId?: string;
  patientId: string;
  agentchainId?: string;
  patientName?: string;
}

export interface AtenxionDoctorCredentials {
  userId: string;
  doctorId: string;
  agentId?: string;
  agentchainId?: string;
}

interface AtenxionRequestBody {
  userId: string;
  patientName: string;
  patientId: string;
  Authorization: string;
  agentId?: string;
  agentchainId?: string;
}

interface AtenxionDoctorRequestBody {
  userId: string;
  doctorId: string;
  Authorization: string;
  agentId?: string;
  agentchainId?: string;
}

export type AtenxionTransactionPayload = JsonRecord;

function resolveServerUrl() {
  return DEFAULT_SERVER_URL;
}

function getHeaders(token?: string | null): { Authorization: string } {
  return { Authorization: token ? `${token}` : "" };
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

function normalizeDoctorCredentials(
  credentials: AtenxionDoctorCredentials
): AtenxionDoctorRequestBody {
  const doctorId = credentials.doctorId.trim();
  const userId = doctorId; // userId is the same as doctorId for doctors
  const agentId = credentials.agentId?.trim();
  // const agentchainId = credentials.agentchainId?.trim();
  
  // Use EMR access token for doctors
  const emrToken = getAccessToken();
  if (!emrToken) {
    throw new Error("No access token available for doctor authentication");
  }

  const body: AtenxionDoctorRequestBody = {
    userId,
    doctorId,
    Authorization: `Bearer ${emrToken}`,
  };
  
  // Include agentId if it exists (following patient pattern)
  if (agentId) {
    body.agentId = agentId.trim();
  }
  
  console.log('[normalizeDoctorCredentials] agentId in body:', body.agentId, 'from input:', agentId);

  // if (agentchainId) {
  //   body.agentchainId = agentchainId;
  // }

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

export async function loginAtenxionDoctor(
  credentials: AtenxionDoctorCredentials,
  // token?: string | null
) {
  const url = `${resolveServerUrl()}/api/post-login/user-login`;
  console.log("Atenxion doctor login URL:", url);
  let resolvedToken = null;
  // Get token from MongoDB admin integration DB (contextKey)
  // let resolvedToken = token;
  // if (!resolvedToken) {
    // Use admin integration for doctors - get contextKey from MongoDB
    const embed = await fetchAdminIntegrationEmbed();
    resolvedToken = embed?.contextKey;


  if (!resolvedToken) {
    console.warn("Atenxion doctor login: No contextKey found in admin integration embed");
    // Continue anyway - the API might work without it or return a proper error
  }

  // Extract agentId from embed if not provided in credentials
  // Follow the same pattern as patients - try agentchainId first, then agentId
  let agentId = credentials.agentId;
  console.log('[loginAtenxionDoctor] Initial agentId from credentials:', agentId);
  
  if (!agentId) {
    console.log('[loginAtenxionDoctor] agentId not in credentials, fetching embed to extract...');
    const embed = await fetchAdminIntegrationEmbed();
    console.log('[loginAtenxionDoctor] Embed fetched:', embed ? 'found' : 'not found');
    
    if (embed?.iframeCode) {
      console.log('[loginAtenxionDoctor] iframeCode length:', embed.iframeCode.length);
      console.log('[loginAtenxionDoctor] iframeCode preview:', embed.iframeCode.substring(0, 300));
      
      // Try agentchainId first (like patients do)
      let agentIdMatch = embed.iframeCode.match(/agentchainId=([^&"'\s]+)/i);
      if (agentIdMatch) {
        agentId = agentIdMatch[1];
        console.log('[loginAtenxionDoctor] ✓ Extracted agentId from agentchainId:', agentId);
      } else {
        // Try agentId patterns
        agentIdMatch = embed.iframeCode.match(/agentId=([^"'\s&]+)/i);
        if (!agentIdMatch) {
          agentIdMatch = embed.iframeCode.match(/"agentId"\s*:\s*"([^"]+)"/i);
        }
        if (!agentIdMatch) {
          agentIdMatch = embed.iframeCode.match(/'agentId'\s*:\s*'([^']+)'/i);
        }
        if (agentIdMatch) {
          agentId = agentIdMatch[1];
          console.log('[loginAtenxionDoctor] ✓ Extracted agentId from embed:', agentId);
        } else {
          console.warn('[loginAtenxionDoctor] ✗ Could not extract agentId from embed iframeCode');
          console.warn('[loginAtenxionDoctor] Full iframeCode:', embed.iframeCode);
        }
      }
    } else {
      console.warn('[loginAtenxionDoctor] Embed has no iframeCode');
    }
  } else {
    console.log('[loginAtenxionDoctor] Using agentId from credentials:', agentId);
  }

  // Ensure agentId is included in credentials
  const finalAgentId = agentId || credentials.agentId;
  console.log('[loginAtenxionDoctor] Final agentId before normalize:', finalAgentId);
  
  const credentialsWithAgentId: AtenxionDoctorCredentials = {
    ...credentials,
    agentId: finalAgentId,
  };
  
  console.log('[loginAtenxionDoctor] credentialsWithAgentId.agentId:', credentialsWithAgentId.agentId);

  const requestBody = normalizeDoctorCredentials(credentialsWithAgentId);
  
  // Use MongoDB contextKey in Authorization header (same as patient login pattern)
  const headers = getHeaders(resolvedToken) || {};

  console.log("Atenxion doctor login API call:", {
    url,
    body: requestBody,
    headers,
    token: resolvedToken ? resolvedToken.substring(0, 20) + "..." : "none",
  });

  try {
    const pp = await axios.post(url, requestBody, { headers });
    console.log("Atenxion doctor login response:", pp);
    return true;
  } catch (error) {
    console.error("Atenxion doctor login failed:", error);
    if (axios.isAxiosError(error)) {
      console.error("Response status:", error.response?.status);
      console.error("Response data:", error.response?.data);
    }
    return handleAxiosError(error, "Unable to log in doctor to Atenxion");
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

export async function logoutAtenxionDoctor(
  credentials: AtenxionDoctorCredentials,
  token?: string | null
) {
  const url = `${resolveServerUrl()}/api/post-login/user-logout`;
  let resolvedToken = token;
  if (!resolvedToken) {
    // Use admin integration for doctors
    const embed = await fetchAdminIntegrationEmbed();
    resolvedToken = embed?.contextKey;
  }
  const body = normalizeDoctorCredentials(credentials);
  const headers = getHeaders(resolvedToken) || {};
  try {
    console.log("Atenxion doctor logout API call:", {
      url,
      body,
      headers,
      token: resolvedToken ? `${resolvedToken.substring(0, 16)}...` : "none",
    });
    await axios.post(url, body, { headers });
    return true;
  } catch (error) {
    console.error("Atenxion doctor logout failed:", error);
    return handleAxiosError(error, "Unable to log out doctor from Atenxion");
  }
}
