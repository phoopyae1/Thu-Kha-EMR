import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { useSettings } from '../context/SettingsProvider';
import type { Role } from '../api/client';
import { fetchIntegrationEmbed, fetchAdminIntegrationEmbed } from '../api/patientPortal';

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
    isScript?: boolean;
  } | null>(null);

  useEffect(() => {
    console.log('[RouteGuard] Widget useEffect triggered - widgetEnabled:', widgetEnabled, 'user:', user?.role, 'pathname:', location.pathname);
    // Widget is only for doctors, not for admin accounts
    console.log('[RouteGuard] Widget loading check - User role:', user?.role);
    const shouldLoadWidget = user?.role === 'Doctor';
    
    console.log('[RouteGuard] shouldLoadWidget calculated:', shouldLoadWidget);
    
    if (!shouldLoadWidget) {
      console.log('[RouteGuard] Widget not loading - shouldLoadWidget is false. user role:', user?.role);
      setWidgetFrame(null);
      return;
    }

    // Don't load if user is not available yet
    if (!user) {
      console.log('[RouteGuard] Widget not loading - user not available yet');
      return;
    }

    let isCancelled = false;

    const loadWidget = async () => {
      try {
        console.log('[RouteGuard] Loading widget for role:', user.role);
        // Fetch from admin integration for doctors, patient portal integration for others
        let embed = null;
        if (user.role === 'Doctor') {
          embed = await fetchAdminIntegrationEmbed();
          console.log('[RouteGuard] Fetched admin embed:', embed ? 'found' : 'not found');
          // Fallback to patient portal integration if admin integration doesn't exist
          if (!embed) {
            console.log('[RouteGuard] Admin embed not found, trying patient portal integration as fallback');
            embed = await fetchIntegrationEmbed();
            console.log('[RouteGuard] Fetched patient portal embed (fallback):', embed ? 'found' : 'not found');
          }
        } else {
          embed = await fetchIntegrationEmbed();
          console.log('[RouteGuard] Fetched patient portal embed:', embed ? 'found' : 'not found');
        }
        
        if (!embed?.iframeCode || typeof document === 'undefined') {
          console.log('[RouteGuard] No embed iframeCode or document undefined. Embed:', embed);
          if (!isCancelled) {
            setWidgetFrame(null);
          }
          return;
        }
        
        console.log('[RouteGuard] Embed iframeCode length:', embed.iframeCode.length);

        let url: string | null = null;
        let isScript = false;

        // Check if it's a script tag
        const scriptTagMatch = embed.iframeCode.match(/<script[^>]+src=["']([^"']+)["']/i);
        if (scriptTagMatch) {
          isScript = true;
          url = scriptTagMatch[1];
        } else {
          // Try to parse as iframe
          const wrapper = document.createElement('div');
          wrapper.innerHTML = embed.iframeCode;
          const iframe = wrapper.querySelector('iframe');
          if (iframe) {
            url = iframe.getAttribute('src');
          }
        }

        if (!url) {
          console.log('[RouteGuard] Failed to extract URL from embed iframeCode');
          if (!isCancelled) {
            setWidgetFrame(null);
          }
          return;
        }
        
        console.log('[RouteGuard] Extracted URL:', url, 'isScript:', isScript);

        // Add userId parameter (using doctorId if available) if user is logged in and postLogin is true
        const postLogin = true; // You can make this configurable if needed
        // Use doctorId as userId if available, otherwise fall back to user.userId
        const userIdToUse = user?.doctorId || user?.userId;
        
        if (userIdToUse && postLogin) {
          console.log('[RouteGuard] Adding userId parameter:', userIdToUse, user?.doctorId ? '(using doctorId)' : '(using user.userId)');
          try {
            // Use URL constructor if it's a valid absolute URL
            if (url.startsWith('http://') || url.startsWith('https://')) {
              const urlObj = new URL(url);
              urlObj.searchParams.set('userId', userIdToUse);
              url = urlObj.toString();
            } else {
              // For relative URLs or invalid URLs, append manually
              const separator = url.includes('?') ? '&' : '?';
              url = `${url}${separator}userId=${userIdToUse}`;
            }
          } catch (error) {
            // If URL parsing fails, append userId as query parameter manually
            const separator = url.includes('?') ? '&' : '?';
            url = `${url}${separator}userId=${userIdToUse}`;
          }
        }

        if (!isCancelled) {
          console.log('[RouteGuard] Setting widget frame - isScript:', isScript, 'url:', url);
          if (isScript) {
            // For script tags, we'll load it as a script element
            setWidgetFrame({
              src: url,
              isScript: true,
            });
          } else {
            // For iframes, use the original logic
            const wrapper = document.createElement('div');
            wrapper.innerHTML = embed.iframeCode;
            const iframe = wrapper.querySelector('iframe');
            setWidgetFrame({
              src: url,
              title: iframe?.getAttribute('title') ?? null,
              allow: iframe?.getAttribute('allow') ?? null,
              loading: iframe?.getAttribute('loading') ?? null,
              isScript: false,
            });
          }
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
  }, [widgetEnabled, location.pathname, user]);
  
  // Check authentication
  if (!accessToken) {
    console.log('[RouteGuard] No access token, redirecting to login');
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }
  
  // Wait for user to be loaded (it might be loading from token)
  if (!user) {
    console.log('[RouteGuard] No user object, showing loading state');
    // Return a loading state instead of null to avoid flickering
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center text-sm text-gray-500">Loading...</div>
      </div>
    );
  }
  
  // Check role permissions
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    console.log('[RouteGuard] User role', user.role, 'not in allowed roles', allowedRoles);
    // Show access denied message instead of redirecting
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-6 w-6 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Access Denied</h1>
          <p className="mt-2 text-sm text-gray-600">You don't have access for this page.</p>
        </div>
      </div>
    );
  }
  
  console.log('[RouteGuard] Access granted for', user.role, 'to', location.pathname);
  
  // Load script tag if it's a script widget
  useEffect(() => {
    if (widgetFrame?.isScript && widgetFrame.src) {
      console.log('[RouteGuard] Loading script widget from:', widgetFrame.src);
      // Check if script already exists
      const existingScript = document.querySelector(`script[src="${widgetFrame.src}"]`);
      if (existingScript) {
        console.log('[RouteGuard] Script already exists, skipping');
        return;
      }

      const script = document.createElement('script');
      script.src = widgetFrame.src;
      script.async = true;
      script.onload = () => {
        console.log('[RouteGuard] Script loaded successfully');
      };
      script.onerror = (error) => {
        console.error('[RouteGuard] Script failed to load:', error);
      };
      document.body.appendChild(script);
      console.log('[RouteGuard] Script element appended to body');

      return () => {
        // Cleanup: remove script when component unmounts or src changes
        const scriptToRemove = document.querySelector(`script[src="${widgetFrame.src}"]`);
        if (scriptToRemove) {
          console.log('[RouteGuard] Removing script on cleanup');
          scriptToRemove.remove();
        }
      };
    }
  }, [widgetFrame?.isScript, widgetFrame?.src]);

  // Widget is only for doctors, not for admin accounts
  const shouldShowWidget = !!widgetFrame && user?.role === 'Doctor';

  console.log('[RouteGuard] Render check - shouldShowWidget:', shouldShowWidget, 'widgetFrame:', widgetFrame ? 'exists' : 'null', 'isScript:', widgetFrame?.isScript, 'user role:', user?.role);

  return (
    <>
      {children}
      {shouldShowWidget && widgetFrame && !widgetFrame.isScript && (
        <iframe
          src={widgetFrame.src}
          title={widgetFrame.title ?? 'Patient portal assistant widget'}
          style={{
            bottom: 0,
            right: 0,
            width: 'min(400px, 90vw)',
            height: '80%',
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
