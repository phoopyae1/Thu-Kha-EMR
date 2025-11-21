import React, { createContext, useContext, useEffect, useState } from 'react';
import { getAccessToken, setAccessToken, subscribeAccessToken } from '../api/http';
import { login as apiLogin, type LoginResponse, type Role } from '../api/client';
import { loginAtenxionUser, logoutAtenxionUser, type AtenxionCredentials } from '../api/atenxion';
import { fetchAdminIntegrationEmbed } from '../api/patientPortal';

interface User {
  userId: string;
  role: Role;
  email: string;
  doctorId?: string | null;
}

interface AuthContextType {
  accessToken: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [accessToken, setAccessTokenState] = useState<string | null>(
    getAccessToken(),
  );
  const [user, setUser] = useState<User | null>(() => decodeAccessToken(getAccessToken()));
  const [currentUserCredentials, setCurrentUserCredentials] = useState<AtenxionCredentials | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeAccessToken((token) => {
      setAccessTokenState(token);
      setUser(decodeAccessToken(token));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    setUser(decodeAccessToken(accessToken));
  }, [accessToken]);

  const login = async (email: string, password: string) => {
    const data: LoginResponse = await apiLogin(email, password);
    setAccessToken(data.accessToken);
    const loggedInUser = {
      userId: data.user.userId,
      role: data.user.role,
      email: data.user.email,
      doctorId: data.user.doctorId ?? null,
    };
    setUser(loggedInUser);

    // Call Atenxion login for doctors
    if (loggedInUser.role === 'Doctor') {
      try {
        // Get admin integration embed to extract agentId if available
        const adminEmbed = await fetchAdminIntegrationEmbed();
        let agentId: string | undefined;
        
        // Try to extract agentId from iframeCode if it's a script tag
        if (adminEmbed?.iframeCode) {
          const agentIdMatch = adminEmbed.iframeCode.match(/agentId=([^"'\s&]+)/i);
          if (agentIdMatch) {
            agentId = agentIdMatch[1];
          }
        }

        const credentials: AtenxionCredentials = {
          userId: loggedInUser.userId,
          patientId: loggedInUser.userId, // For doctors, use userId as patientId
          patientName: loggedInUser.email,
          agentId,
        };
        
        setCurrentUserCredentials(credentials);
        await loginAtenxionUser(credentials, undefined, true); // true = useAdminIntegration
        console.log('[AuthProvider] Atenxion login successful for doctor');
      } catch (error) {
        console.error('[AuthProvider] Atenxion login failed for doctor:', error);
        // Don't block login if Atenxion login fails
      }
    }
  };

  const logout = async () => {
    // Call Atenxion logout for doctors before clearing session
    if (user?.role === 'Doctor' && currentUserCredentials) {
      try {
        await logoutAtenxionUser(currentUserCredentials, undefined, true); // true = useAdminIntegration
        console.log('[AuthProvider] Atenxion logout successful for doctor');
      } catch (error) {
        console.error('[AuthProvider] Atenxion logout failed for doctor:', error);
        // Continue with logout even if Atenxion logout fails
      }
    }
    
    setCurrentUserCredentials(null);
    setAccessToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ accessToken, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

function decodeAccessToken(token: string | null): User | null {
  if (!token) return null;
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    const normalized = normalizeBase64(payload);
    const parsed = JSON.parse(atob(normalized)) as {
      sub?: string;
      role?: Role;
      email?: string;
      doctorId?: string | null;
    };
    if (!parsed.sub || !parsed.role || !parsed.email) {
      return null;
    }
    return {
      userId: parsed.sub,
      role: parsed.role,
      email: parsed.email,
      doctorId: parsed.doctorId ?? null,
    };
  } catch {
    return null;
  }
}

function normalizeBase64(value: string): string {
  const replaced = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = replaced.length % 4;
  if (padding === 2) return `${replaced}==`;
  if (padding === 3) return `${replaced}=`;
  if (padding === 1) return `${replaced}===`;
  return replaced;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
