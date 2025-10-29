import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import LoginCard from '../components/LoginCard';
import PageLayout from '../components/PageLayout';
import { useSettings } from '../context/SettingsProvider';
import { useTranslation } from '../hooks/useTranslation';
import { fetchIntegrationEmbed, type IntegrationEmbed } from '../api/patientPortal';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [widgetFrame, setWidgetFrame] = useState<{
    src: string;
    title?: string | null;
    allow?: string | null;
    loading?: string | null;
  } | null>(null);
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const { appName, logo, widgetEnabled, setWidgetEnabled } = useSettings();
  const { t } = useTranslation();

  // Handle redirect after successful login
  useEffect(() => {
    if (user?.userId) {
      navigate(`/admin/${user.userId}`);
    }
  }, [user, navigate]);

  // Load widget iframe before login
  useEffect(() => {
    console.log('🔧 Widget Debug - widgetEnabled:', widgetEnabled);
    
    if (!widgetEnabled) {
      console.log('🔧 Widget Debug - widget is disabled, hiding widget');
      setWidgetFrame(null);
      return;
    }

    let isCancelled = false;

    const loadWidget = async () => {
      try {
        console.log('🔧 Widget Debug - fetching integration embed...');
        const embed = await fetchIntegrationEmbed();
        console.log('🔧 Widget Debug - embed result:', embed);
        
        // If no embed is configured, use a fallback test widget
        if (!embed?.iframeCode || typeof document === 'undefined') {
          console.log('🔧 Widget Debug - no iframe code, using fallback widget');
          if (!isCancelled) {
            setWidgetFrame({
              src: 'https://calendar.google.com/calendar/embed?src=primary&ctz=America%2FNew_York',
              title: 'Patient Portal Widget (Test)',
              allow: 'camera; microphone; geolocation',
              loading: 'lazy',
            });
          }
          return;
        }

        console.log('🔧 Widget Debug - iframe code found:', embed.iframeCode);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = embed.iframeCode;
        const iframe = wrapper.querySelector('iframe');
        
        if (iframe && !isCancelled) {
          console.log('🔧 Widget Debug - iframe element found:', iframe);
          setWidgetFrame({
            src: iframe.src,
            title: iframe.title || 'Patient Portal Widget',
            allow: iframe.allow || 'camera; microphone; geolocation',
            loading: iframe.loading || 'lazy',
          });
          console.log('🔧 Widget Debug - widget frame set successfully');
        } else {
          console.log('🔧 Widget Debug - no iframe element found in code');
        }
      } catch (error) {
        console.warn('🔧 Widget Debug - Failed to load integration widget:', error);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await login(email, password);
      setSuccess(t('Login successful'));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'username') setEmail(value);
    if (name === 'password') setPassword(value);
  };

  const values = { username: email, password };

  return (
    <PageLayout maxWidth="max-w-6xl">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Login Form */}
        <div className="flex flex-col justify-center">
          {/* Debug Section - Remove this in production */}
          <div className="mb-4 rounded-md bg-yellow-100 p-3 text-sm">
            <div className="font-semibold text-yellow-800">Debug Info:</div>
            <div>Widget Enabled: {widgetEnabled ? 'Yes' : 'No'}</div>
            <div>Widget Frame: {widgetFrame ? 'Loaded' : 'Not loaded'}</div>
            <div>Widget Frame Src: {widgetFrame?.src || 'None'}</div>
            <button
              type="button"
              onClick={() => {
                console.log('🔧 Toggle clicked - current state:', widgetEnabled);
                setWidgetEnabled(!widgetEnabled);
              }}
              className="mt-2 rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
            >
              Toggle Widget
            </button>
            <button
              type="button"
              onClick={() => {
                console.log('🔧 Force load widget');
                setWidgetFrame({
                  src: 'https://calendar.google.com/calendar/embed?src=primary&ctz=America%2FNew_York',
                  title: 'Test Widget',
                  allow: 'camera; microphone; geolocation',
                  loading: 'lazy',
                });
              }}
              className="mt-1 ml-2 rounded bg-green-500 px-2 py-1 text-xs text-white hover:bg-green-600"
            >
              Force Load Test Widget
            </button>
          </div>
          
          {error && (
            <div className="mb-4 rounded-md bg-red-100 p-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 rounded-md bg-green-100 p-2 text-sm text-green-700">
              {success}
            </div>
          )}
          <LoginCard
            onSubmit={handleSubmit}
            values={values}
            onChange={handleChange}
            appName={appName}
            logo={logo}
          />
        </div>

        {/* Widget Iframe */}
        {widgetEnabled && (
          <div className="flex flex-col justify-center">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-4 text-lg font-semibold text-gray-900">
                {t('Patient Portal')} - Widget Enabled
              </h3>
              <div className="mb-2 text-xs text-gray-500">
                Debug: Widget should be visible here
              </div>
              {widgetFrame ? (
                <div className="relative">
                  <iframe
                    src={widgetFrame.src}
                    title={widgetFrame.title || undefined}
                    allow={widgetFrame.allow || undefined}
                    loading={widgetFrame.loading as "lazy" | "eager" | undefined}
                    className="h-96 w-full rounded border-0"
                    style={{ minHeight: '400px' }}
                  />
                </div>
              ) : (
                <div className="flex h-96 items-center justify-center rounded border border-gray-200 bg-gray-50">
                  <div className="text-center">
                    <p className="text-sm text-gray-500">
                      {t('Patient portal widget is loading...')}
                    </p>
                    <p className="mt-2 text-xs text-gray-400">
                      Debug: widgetFrame is null
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        console.log('🔧 Force load from loading state');
                        setWidgetFrame({
                          src: 'https://calendar.google.com/calendar/embed?src=primary&ctz=America%2FNew_York',
                          title: 'Test Widget',
                          allow: 'camera; microphone; geolocation',
                          loading: 'lazy',
                        });
                      }}
                      className="mt-2 rounded bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600"
                    >
                      Load Test Widget
                    </button>
                  </div>
                </div>
              )}
              <p className="mt-2 text-xs text-gray-500">
                {t('Access your patient portal to schedule appointments and manage your health records.')}
              </p>
              <p className="mt-1 text-xs text-blue-600">
                {t('Public access - no login required for widget')}
              </p>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
