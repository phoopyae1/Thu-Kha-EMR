import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { useSettings } from '../context/SettingsProvider';
import type { Role } from '../api/client';
import { fetchIntegrationEmbed } from '../api/patientPortal';

interface Props {
  children: ReactNode;
  allowedRoles?: Role[];
}

export default function RouteGuard({ children, allowedRoles }: Props) {
  const { accessToken, user } = useAuth();
  const { widgetEnabled } = useSettings();
  const location = useLocation();
  const [widgetFrame, setWidgetFrame] = useState<{
    src: string;
    title?: string | null;
    allow?: string | null;
    loading?: string | null;
  } | null>(null);

  useEffect(() => {
    if (!widgetEnabled) {
      setWidgetFrame(null);
      return;
    }

    let isCancelled = false;

    const loadWidget = async () => {
      try {
        const embed = await fetchIntegrationEmbed();
        if (!embed?.iframeCode || typeof document === 'undefined') {
          if (!isCancelled) {
            setWidgetFrame(null);
          }
          return;
        }

        const wrapper = document.createElement('div');
        wrapper.innerHTML = embed.iframeCode;
        const iframe = wrapper.querySelector('iframe');

        if (!iframe) {
          if (!isCancelled) {
            setWidgetFrame(null);
          }
          return;
        }

        const srcAttr = iframe.getAttribute('src');
        if (!srcAttr) {
          if (!isCancelled) {
            setWidgetFrame(null);
          }
          return;
        }

        if (!isCancelled) {
          setWidgetFrame({
            src: srcAttr.trim(),
            title: iframe.getAttribute('title'),
            allow: iframe.getAttribute('allow'),
            loading: iframe.getAttribute('loading'),
          });
        }
      } catch (error) {
        console.error('Failed to load integration widget', error);
        if (!isCancelled) {
          setWidgetFrame(null);
        }
      }
    };

    loadWidget();

    return () => {
      isCancelled = true;
    };
  }, [widgetEnabled]);
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
      {widgetEnabled && widgetFrame && (
        <iframe
          src={widgetFrame.src}
          title={widgetFrame.title ?? 'Patient portal assistant widget'}
          style={{
            bottom: 0,
            right: 0,
            // width: 'min(420px, 90vw)',
            height: 'min(620px, 90vh)',
            position: 'fixed',
          }}
          frameBorder="0"
          allow={
            widgetFrame.allow ??
            "midi 'src'; geolocation 'src'; microphone 'src'; camera 'src'; display-capture 'src'; encrypted-media 'src';"
          }
          // loading={widgetFrame.loading ?? 'lazy'}
        ></iframe>
      )}
    </>
  );
}
