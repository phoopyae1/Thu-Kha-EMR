import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { useSettings } from '../context/SettingsProvider';
import type { Role } from '../api/client';

interface Props {
  children: ReactNode;
  allowedRoles?: Role[];
}

export default function RouteGuard({ children, allowedRoles }: Props) {
  const { accessToken, user } = useAuth();
  const { widgetEnabled } = useSettings();
  const location = useLocation();
  if (!accessToken) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }
  if (!user) {
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(user.role) && user.role !== 'ITAdmin') {
    return <Navigate to="/" replace />;
  }
  return (
    <>
      {children}
      {widgetEnabled && (
        <iframe
          src="https://demo.atenxion.ai/chat-widget?agentchainId=68c11a6aac23300903b7d455"
          style={{ bottom: 0, right: 0, width: '90%', height: '90%', position: 'fixed' }}
          frameBorder="0"
          allow="midi 'src'; geolocation 'src'; microphone 'src'; camera 'src'; display-capture 'src'; encrypted-media 'src';"
        ></iframe>
      )}
    </>
  );
}
