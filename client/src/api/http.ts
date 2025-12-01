const ACCESS_TOKEN_KEY = 'emr_access_token';

// Initialize from localStorage
let accessToken: string | null = null;
try {
  accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
} catch {
  // Ignore localStorage errors
}

let listeners: Array<(token: string | null) => void> = [];

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
  
  // Persist to localStorage
  try {
    if (token) {
      localStorage.setItem(ACCESS_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
    }
  } catch {
    // Ignore localStorage errors
  }
  
  listeners.forEach((cb) => cb(token));
}

export function subscribeAccessToken(cb: (token: string | null) => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((fn) => fn !== cb);
  };
}

export async function fetchJSON(
  path: string,
  options: RequestInit = {},
  retry = true,
) {
  const headers = new Headers(options.headers || {});
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(`/api${path}`, { ...options, headers });

  if (response.status === 401 && retry) {
    const refreshRes = await fetch('/api/auth/token/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (refreshRes.ok) {
      const refreshData = await refreshRes.json();
      setAccessToken(refreshData.accessToken);
      headers.set('Authorization', `Bearer ${refreshData.accessToken}`);
      const retryRes = await fetch(`/api${path}`, { ...options, headers });
      if (!retryRes.ok) {
        const errText = await retryRes.text();
        throw new Error(errText || retryRes.statusText);
      }
      // Handle 204 No Content responses
      if (retryRes.status === 204 || retryRes.status === 202) {
        return null;
      }
      return retryRes.json();
    }
    setAccessToken(null);
  }

  if (!response.ok) {
    if (response.status === 401) {
      setAccessToken(null);
    }
    const errText = await response.text();
    // Try to parse JSON error response
    try {
      const errorJson = JSON.parse(errText);
      // Check for different error response formats
      if (errorJson && typeof errorJson.message === 'string') {
        const error = new Error(errorJson.message);
        (error as any).response = { status: response.status, data: errorJson };
        throw error;
      }
      if (errorJson && typeof errorJson.error === 'string') {
        const error = new Error(errorJson.error);
        (error as any).response = { status: response.status, data: errorJson };
        throw error;
      }
    } catch (parseError) {
      // If it's already an Error with response, re-throw it
      if (parseError instanceof Error && (parseError as any).response) {
        throw parseError;
      }
      // Otherwise create a new error with response structure
      const error = new Error(errText || response.statusText);
      (error as any).response = { status: response.status, data: { message: errText || response.statusText } };
      throw error;
    }
    // Fallback (shouldn't reach here, but just in case)
    const error = new Error(errText || response.statusText);
    (error as any).response = { status: response.status, data: { message: errText || response.statusText } };
    throw error;
  }
  
  // Handle 204 No Content and 202 Accepted responses (no body)
  if (response.status === 204 || response.status === 202) {
    return null;
  }
  
  // Check if response has content before parsing JSON
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    return text || null;
  }
  
  return response.json();
}
