import React, { createContext, useContext, useEffect, useState } from 'react';
import { getAccessToken, setAccessToken, subscribeAccessToken } from '../api/http';
import { login as apiLogin, type LoginResponse, type Role } from '../api/client';
import { loginAtenxionUser, logoutAtenxionUser, loginAtenxionDoctor, logoutAtenxionDoctor, loginAtenxionCashier, logoutAtenxionCashier, type AtenxionCredentials, type AtenxionDoctorCredentials, type AtenxionCashierCredentials } from '../api/atenxion';
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
  const [currentUserCredentials, setCurrentUserCredentials] = useState<AtenxionCredentials | AtenxionDoctorCredentials | AtenxionCashierCredentials | null>(null);

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
    if (loggedInUser.role === 'Doctor' && loggedInUser.doctorId) {
      try {
        // Get admin integration embed to extract agentId if available
        // Follow the same pattern as patients - try agentchainId first, then agentId
        const adminEmbed = await fetchAdminIntegrationEmbed();
        let agentId: string | undefined;
        
        if (adminEmbed?.iframeCode) {
          // Try agentchainId first (like patients do)
          let agentIdMatch = adminEmbed.iframeCode.match(/agentchainId=([^&"'\s]+)/i);
          if (agentIdMatch) {
            agentId = agentIdMatch[1];
            console.log('[AuthProvider] Extracted agentId from agentchainId:', agentId);
          } else {
            // Fallback to agentId pattern
            agentIdMatch = adminEmbed.iframeCode.match(/agentId=([^"'\s&]+)/i);
            if (agentIdMatch) {
              agentId = agentIdMatch[1];
              console.log('[AuthProvider] Extracted agentId from embed:', agentId);
            } else {
              console.warn('[AuthProvider] Could not extract agentId from embed iframeCode');
            }
          }
        }

        const doctorCredentials: AtenxionDoctorCredentials = {
          doctorId: loggedInUser.doctorId,
          agentId:agentId,
          userId: loggedInUser.doctorId,
        };
        
        setCurrentUserCredentials(doctorCredentials); // Store for logout
        await loginAtenxionDoctor(doctorCredentials);
        console.log('[AuthProvider] Atenxion doctor login successful');
      } catch (error) {
        console.error('[AuthProvider] Atenxion doctor login failed:', error);
      }
    }
    
    // Call Atenxion login for cashiers
    if (loggedInUser.role === 'Cashier') {
      try {
        // Get admin integration embed for cashiers to extract agentId if available
        const adminEmbed = await fetchAdminIntegrationEmbed('Cashier');
        let agentId: string | undefined;
        
        if (adminEmbed?.iframeCode) {
          // Try agentchainId first (like patients do)
          let agentIdMatch = adminEmbed.iframeCode.match(/agentchainId=([^&"'\s]+)/i);
          if (agentIdMatch) {
            agentId = agentIdMatch[1];
            console.log('[AuthProvider] Extracted agentId from agentchainId for cashier:', agentId);
          } else {
            // Fallback to agentId pattern
            agentIdMatch = adminEmbed.iframeCode.match(/agentId=([^"'\s&]+)/i);
            if (agentIdMatch) {
              agentId = agentIdMatch[1];
              console.log('[AuthProvider] Extracted agentId from embed for cashier:', agentId);
            } else {
              console.warn('[AuthProvider] Could not extract agentId from embed iframeCode for cashier');
            }
          }
        }

        const cashierCredentials: AtenxionCashierCredentials = {
          cashierId: loggedInUser.userId,
          agentId: agentId,
          userId: loggedInUser.userId,
        };
        
        setCurrentUserCredentials(cashierCredentials); // Store for logout
        await loginAtenxionCashier(cashierCredentials);
        console.log('[AuthProvider] Atenxion cashier login successful');
      } catch (error) {
        console.error('[AuthProvider] Atenxion cashier login failed:', error);
      }
    }
  };

  const logout = async () => {
    // Call Atenxion logout for doctors before clearing session
    if (user?.role === 'Doctor' && currentUserCredentials && user.doctorId) {
      try {
        const doctorCredentials: AtenxionDoctorCredentials = {
          doctorId: user.doctorId,
          userId: user.doctorId,
          agentId: (currentUserCredentials as AtenxionDoctorCredentials).agentId,
        };
        await logoutAtenxionDoctor(doctorCredentials);
        console.log('[AuthProvider] Atenxion doctor logout successful');
      } catch (error) {
        console.error('[AuthProvider] Atenxion doctor logout failed:', error);
        // Continue with logout even if Atenxion logout fails
      }
    }
    
    // Call Atenxion logout for cashiers before clearing session
    if (user?.role === 'Cashier' && currentUserCredentials) {
      try {
        const cashierCredentials: AtenxionCashierCredentials = {
          cashierId: user.userId,
          userId: user.userId,
          agentId: (currentUserCredentials as AtenxionCashierCredentials).agentId,
        };
        await logoutAtenxionCashier(cashierCredentials);
        console.log('[AuthProvider] Atenxion cashier logout successful');
      } catch (error) {
        console.error('[AuthProvider] Atenxion cashier logout failed:', error);
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
