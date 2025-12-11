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

export interface AtenxionCashierCredentials {
  userId: string;
  cashierId: string;
  agentId?: string;
  agentchainId?: string;
}

export interface AtenxionITAdminCredentials {
  userId: string;
  itAdminId: string;
  agentId?: string;
  agentchainId?: string;
}

export interface AtenxionLabTechCredentials {
  userId: string;
  labTechId: string;
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

interface AtenxionCashierRequestBody {
  userId: string;
  cashierId: string;
  Authorization: string;
  agentId?: string;
  agentchainId?: string;
}

interface AtenxionITAdminRequestBody {
  userId: string;
  itAdminId: string;
  Authorization: string;
  agentId?: string;
  agentchainId?: string;
}

interface AtenxionLabTechRequestBody {
  userId: string;
  labTechId: string;
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

function normalizeCashierCredentials(
  credentials: AtenxionCashierCredentials
): AtenxionCashierRequestBody {
  const cashierId = credentials.cashierId.trim();
  const userId = cashierId; // userId is the same as cashierId for cashiers
  const agentId = credentials.agentId?.trim();
  
  // Use EMR access token for cashiers
  const emrToken = getAccessToken();
  if (!emrToken) {
    throw new Error("No access token available for cashier authentication");
  }

  const body: AtenxionCashierRequestBody = {
    userId,
    cashierId,
    Authorization: `Bearer ${emrToken}`,
  };
  
  // Include agentId if it exists (following patient pattern)
  if (agentId) {
    body.agentId = agentId.trim();
  }
  
  console.log('[normalizeCashierCredentials] agentId in body:', body.agentId, 'from input:', agentId);

  return body;
}

function normalizeITAdminCredentials(
  credentials: AtenxionITAdminCredentials
): AtenxionITAdminRequestBody {
  const itAdminId = credentials.itAdminId.trim();
  const userId = itAdminId; // userId is the same as itAdminId for IT admins
  const agentId = credentials.agentId?.trim();
  
  // Use EMR access token for IT admins
  const emrToken = getAccessToken();
  if (!emrToken) {
    throw new Error("No access token available for IT admin authentication");
  }

  const body: AtenxionITAdminRequestBody = {
    userId,
    itAdminId,
    Authorization: `Bearer ${emrToken}`,
  };
  
  // Include agentId if it exists (following patient pattern)
  if (agentId) {
    body.agentId = agentId.trim();
  }
  
  console.log('[normalizeITAdminCredentials] agentId in body:', body.agentId, 'from input:', agentId);

  return body;
}

function normalizeLabTechCredentials(
  credentials: AtenxionLabTechCredentials
): AtenxionLabTechRequestBody {
  const labTechId = credentials.labTechId.trim();
  const userId = labTechId; // userId is the same as labTechId for lab technicians
  const agentId = credentials.agentId?.trim();
  
  // Use EMR access token for lab technicians
  const emrToken = getAccessToken();
  if (!emrToken) {
    throw new Error("No access token available for lab technician authentication");
  }

  const body: AtenxionLabTechRequestBody = {
    userId,
    labTechId,
    Authorization: `Bearer ${emrToken}`,
  };
  
  // Include agentId if it exists (following patient pattern)
  if (agentId) {
    body.agentId = agentId.trim();
  }
  
  console.log('[normalizeLabTechCredentials] agentId in body:', body.agentId, 'from input:', agentId);

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

export async function loginAtenxionCashier(
  credentials: AtenxionCashierCredentials,
) {
  const url = `${resolveServerUrl()}/api/post-login/user-login`;
  console.log("Atenxion cashier login URL:", url);
  let resolvedToken = null;
  // Get token from MongoDB admin integration DB (contextKey)
  // Use admin integration for cashiers - get contextKey from MongoDB adminIntegrationSettings_cashier collection
  const embed = await fetchAdminIntegrationEmbed('Cashier');
  resolvedToken = embed?.contextKey;

  if (!resolvedToken) {
    console.warn("Atenxion cashier login: No contextKey found in admin integration embed");
    // Continue anyway - the API might work without it or return a proper error
  }

  // Extract agentId from embed if not provided in credentials
  // Follow the same pattern as doctors - try agentchainId first, then agentId
  let agentId = credentials.agentId;
  console.log('[loginAtenxionCashier] Initial agentId from credentials:', agentId);
  
  if (!agentId) {
    console.log('[loginAtenxionCashier] agentId not in credentials, fetching embed to extract...');
    const embed = await fetchAdminIntegrationEmbed('Cashier');
    console.log('[loginAtenxionCashier] Embed fetched:', embed ? 'found' : 'not found');
    
    if (embed?.iframeCode) {
      console.log('[loginAtenxionCashier] iframeCode length:', embed.iframeCode.length);
      console.log('[loginAtenxionCashier] iframeCode preview:', embed.iframeCode.substring(0, 300));
      
      // Try agentchainId first (like patients do)
      let agentIdMatch = embed.iframeCode.match(/agentchainId=([^&"'\s]+)/i);
      if (agentIdMatch) {
        agentId = agentIdMatch[1];
        console.log('[loginAtenxionCashier] ✓ Extracted agentId from agentchainId:', agentId);
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
          console.log('[loginAtenxionCashier] ✓ Extracted agentId from embed:', agentId);
        } else {
          console.warn('[loginAtenxionCashier] ✗ Could not extract agentId from embed iframeCode');
          console.warn('[loginAtenxionCashier] Full iframeCode:', embed.iframeCode);
        }
      }
    } else {
      console.warn('[loginAtenxionCashier] Embed has no iframeCode');
    }
  } else {
    console.log('[loginAtenxionCashier] Using agentId from credentials:', agentId);
  }

  // Ensure agentId is included in credentials
  const finalAgentId = agentId || credentials.agentId;
  console.log('[loginAtenxionCashier] Final agentId before normalize:', finalAgentId);
  
  const credentialsWithAgentId: AtenxionCashierCredentials = {
    ...credentials,
    agentId: finalAgentId,
  };
  
  console.log('[loginAtenxionCashier] credentialsWithAgentId.agentId:', credentialsWithAgentId.agentId);

  const requestBody = normalizeCashierCredentials(credentialsWithAgentId);
  
  // Use MongoDB contextKey in Authorization header (same as doctor login pattern)
  const headers = getHeaders(resolvedToken) || {};

  console.log("Atenxion cashier login API call:", {
    url,
    body: requestBody,
    headers,
    token: resolvedToken ? resolvedToken.substring(0, 20) + "..." : "none",
  });

  try {
    const pp = await axios.post(url, requestBody, { headers });
    console.log("Atenxion cashier login response:", pp);
    return true;
  } catch (error) {
    console.error("Atenxion cashier login failed:", error);
    if (axios.isAxiosError(error)) {
      console.error("Response status:", error.response?.status);
      console.error("Response data:", error.response?.data);
    }
    return handleAxiosError(error, "Unable to log in cashier to Atenxion");
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

export async function logoutAtenxionCashier(
  credentials: AtenxionCashierCredentials,
  token?: string | null
) {
  const url = `${resolveServerUrl()}/api/post-login/user-logout`;
  let resolvedToken = token;
  if (!resolvedToken) {
    // Use admin integration for cashiers - get contextKey from MongoDB adminIntegrationSettings_cashier collection
    const embed = await fetchAdminIntegrationEmbed('Cashier');
    resolvedToken = embed?.contextKey;
  }
  const body = normalizeCashierCredentials(credentials);
  const headers = getHeaders(resolvedToken) || {};
  try {
    console.log("Atenxion cashier logout API call:", {
      url,
      body,
      headers,
      token: resolvedToken ? `${resolvedToken.substring(0, 16)}...` : "none",
    });
    await axios.post(url, body, { headers });
    return true;
  } catch (error) {
    console.error("Atenxion cashier logout failed:", error);
    return handleAxiosError(error, "Unable to log out cashier from Atenxion");
  }
}

export async function loginAtenxionITAdmin(
  credentials: AtenxionITAdminCredentials,
) {
  const url = `${resolveServerUrl()}/api/post-login/user-login`;
  console.log("Atenxion IT admin login URL:", url);
  let resolvedToken = null;
  // Get token from MongoDB admin integration DB (contextKey)
  // Use admin integration for IT admins - get contextKey from MongoDB adminIntegrationSettings_itadmin collection
  const embed = await fetchAdminIntegrationEmbed('ITAdmin');
  resolvedToken = embed?.contextKey;

  if (!resolvedToken) {
    console.warn("Atenxion IT admin login: No contextKey found in admin integration embed");
    // Continue anyway - the API might work without it or return a proper error
  }

  // Extract agentId from embed if not provided in credentials
  // Follow the same pattern as doctors - try agentchainId first, then agentId
  let agentId = credentials.agentId;
  console.log('[loginAtenxionITAdmin] Initial agentId from credentials:', agentId);
  
  if (!agentId) {
    console.log('[loginAtenxionITAdmin] agentId not in credentials, fetching embed to extract...');
    const embed = await fetchAdminIntegrationEmbed('ITAdmin');
    console.log('[loginAtenxionITAdmin] Embed fetched:', embed ? 'found' : 'not found');
    
    if (embed?.iframeCode) {
      console.log('[loginAtenxionITAdmin] iframeCode length:', embed.iframeCode.length);
      console.log('[loginAtenxionITAdmin] iframeCode preview:', embed.iframeCode.substring(0, 300));
      
      // Try agentchainId first (like patients do)
      let agentIdMatch = embed.iframeCode.match(/agentchainId=([^&"'\s]+)/i);
      if (agentIdMatch) {
        agentId = agentIdMatch[1];
        console.log('[loginAtenxionITAdmin] ✓ Extracted agentId from agentchainId:', agentId);
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
          console.log('[loginAtenxionITAdmin] ✓ Extracted agentId from embed:', agentId);
        } else {
          console.warn('[loginAtenxionITAdmin] ✗ Could not extract agentId from embed iframeCode');
          console.warn('[loginAtenxionITAdmin] Full iframeCode:', embed.iframeCode);
        }
      }
    } else {
      console.warn('[loginAtenxionITAdmin] Embed has no iframeCode');
    }
  } else {
    console.log('[loginAtenxionITAdmin] Using agentId from credentials:', agentId);
  }

  // Ensure agentId is included in credentials
  const finalAgentId = agentId || credentials.agentId;
  console.log('[loginAtenxionITAdmin] Final agentId before normalize:', finalAgentId);
  
  const credentialsWithAgentId: AtenxionITAdminCredentials = {
    ...credentials,
    agentId: finalAgentId,
  };
  
  console.log('[loginAtenxionITAdmin] credentialsWithAgentId.agentId:', credentialsWithAgentId.agentId);

  const requestBody = normalizeITAdminCredentials(credentialsWithAgentId);
  
  // Use MongoDB contextKey in Authorization header (same as doctor login pattern)
  const headers = getHeaders(resolvedToken) || {};

  console.log("Atenxion IT admin login API call:", {
    url,
    body: requestBody,
    headers,
    token: resolvedToken ? resolvedToken.substring(0, 20) + "..." : "none",
  });

  try {
    const pp = await axios.post(url, requestBody, { headers });
    console.log("Atenxion IT admin login response:", pp);
    return true;
  } catch (error) {
    console.error("Atenxion IT admin login failed:", error);
    if (axios.isAxiosError(error)) {
      console.error("Response status:", error.response?.status);
      console.error("Response data:", error.response?.data);
    }
    return handleAxiosError(error, "Unable to log in IT admin to Atenxion");
  }
}

export async function loginAtenxionLabTech(
  credentials: AtenxionLabTechCredentials,
) {
  const url = `${resolveServerUrl()}/api/post-login/user-login`;
  console.log("Atenxion lab tech login URL:", url);
  let resolvedToken = null;
  // Get token from MongoDB admin integration DB (contextKey)
  // Use admin integration for lab technicians - get contextKey from MongoDB adminIntegrationSettings_labtech collection
  const embed = await fetchAdminIntegrationEmbed('LabTech');
  resolvedToken = embed?.contextKey;

  if (!resolvedToken) {
    console.warn("Atenxion lab tech login: No contextKey found in admin integration embed");
    // Continue anyway - the API might work without it or return a proper error
  }

  // Extract agentId from embed if not provided in credentials
  // Follow the same pattern as doctors - try agentchainId first, then agentId
  let agentId = credentials.agentId;
  console.log('[loginAtenxionLabTech] Initial agentId from credentials:', agentId);
  
  if (!agentId) {
    console.log('[loginAtenxionLabTech] agentId not in credentials, fetching embed to extract...');
    const embed = await fetchAdminIntegrationEmbed('LabTech');
    console.log('[loginAtenxionLabTech] Embed fetched:', embed ? 'found' : 'not found');
    
    if (embed?.iframeCode) {
      console.log('[loginAtenxionLabTech] iframeCode length:', embed.iframeCode.length);
      console.log('[loginAtenxionLabTech] iframeCode preview:', embed.iframeCode.substring(0, 300));
      
      // Try agentchainId first (like patients do)
      let agentIdMatch = embed.iframeCode.match(/agentchainId=([^&"'\s]+)/i);
      if (agentIdMatch) {
        agentId = agentIdMatch[1];
        console.log('[loginAtenxionLabTech] ✓ Extracted agentId from agentchainId:', agentId);
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
          console.log('[loginAtenxionLabTech] ✓ Extracted agentId from embed:', agentId);
        } else {
          console.warn('[loginAtenxionLabTech] ✗ Could not extract agentId from embed iframeCode');
          console.warn('[loginAtenxionLabTech] Full iframeCode:', embed.iframeCode);
        }
      }
    } else {
      console.warn('[loginAtenxionLabTech] Embed has no iframeCode');
    }
  } else {
    console.log('[loginAtenxionLabTech] Using agentId from credentials:', agentId);
  }

  // Ensure agentId is included in credentials
  const finalAgentId = agentId || credentials.agentId;
  console.log('[loginAtenxionLabTech] Final agentId before normalize:', finalAgentId);
  
  const credentialsWithAgentId: AtenxionLabTechCredentials = {
    ...credentials,
    agentId: finalAgentId,
  };
  
  console.log('[loginAtenxionLabTech] credentialsWithAgentId.agentId:', credentialsWithAgentId.agentId);

  const requestBody = normalizeLabTechCredentials(credentialsWithAgentId);
  
  // Use MongoDB contextKey in Authorization header (same as doctor login pattern)
  const headers = getHeaders(resolvedToken) || {};

  console.log("Atenxion lab tech login API call:", {
    url,
    body: requestBody,
    headers,
    token: resolvedToken ? resolvedToken.substring(0, 20) + "..." : "none",
  });

  try {
    const pp = await axios.post(url, requestBody, { headers });
    console.log("Atenxion lab tech login response:", pp);
    return true;
  } catch (error) {
    console.error("Atenxion lab tech login failed:", error);
    if (axios.isAxiosError(error)) {
      console.error("Response status:", error.response?.status);
      console.error("Response data:", error.response?.data);
    }
    return handleAxiosError(error, "Unable to log in lab technician to Atenxion");
  }
}

export async function logoutAtenxionITAdmin(
  credentials: AtenxionITAdminCredentials,
  token?: string | null
) {
  const url = `${resolveServerUrl()}/api/post-login/user-logout`;
  let resolvedToken = token;
  if (!resolvedToken) {
    // Use admin integration for IT admins - get contextKey from MongoDB adminIntegrationSettings_itadmin collection
    const embed = await fetchAdminIntegrationEmbed('ITAdmin');
    resolvedToken = embed?.contextKey;
  }
  const body = normalizeITAdminCredentials(credentials);
  const headers = getHeaders(resolvedToken) || {};
  try {
    console.log("Atenxion IT admin logout API call:", {
      url,
      body,
      headers,
      token: resolvedToken ? `${resolvedToken.substring(0, 16)}...` : "none",
    });
    await axios.post(url, body, { headers });
    return true;
  } catch (error) {
    console.error("Atenxion IT admin logout failed:", error);
    return handleAxiosError(error, "Unable to log out IT admin from Atenxion");
  }
}

export async function logoutAtenxionLabTech(
  credentials: AtenxionLabTechCredentials,
  token?: string | null
) {
  const url = `${resolveServerUrl()}/api/post-login/user-logout`;
  let resolvedToken = token;
  if (!resolvedToken) {
    // Use admin integration for lab technicians - get contextKey from MongoDB adminIntegrationSettings_labtech collection
    const embed = await fetchAdminIntegrationEmbed('LabTech');
    resolvedToken = embed?.contextKey;
  }
  const body = normalizeLabTechCredentials(credentials);
  const headers = getHeaders(resolvedToken) || {};
  try {
    console.log("Atenxion lab tech logout API call:", {
      url,
      body,
      headers,
      token: resolvedToken ? `${resolvedToken.substring(0, 16)}...` : "none",
    });
    await axios.post(url, body, { headers });
    return true;
  } catch (error) {
    console.error("Atenxion lab tech logout failed:", error);
    return handleAxiosError(error, "Unable to log out lab technician from Atenxion");
  }
}
