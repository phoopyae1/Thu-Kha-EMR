import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { CalendarIcon, MessageIcon, ReportsIcon } from '../components/icons';
import { useSettings } from '../context/SettingsProvider';
import { useTranslation } from '../hooks/useTranslation';
// Removed debug/test widget imports from admin login

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);
  // Removed success toast; we redirect on successful login
  const { login, user, accessToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { appName, logo } = useSettings();
  const { t } = useTranslation();
  const displayName = useMemo(() => appName || 'Thu Kha', [appName]);

  // Handle redirect after successful login
  // Only redirect if we're on the login page, user is logged in, AND we've attempted a login
  // Also check accessToken to ensure user is actually authenticated (not just stale state)
  // This prevents redirect loops when user logs out
  useEffect(() => {
    // Only redirect if:
    // 1. User exists and has userId
    // 2. Access token exists (ensures user is actually authenticated, not just stale state)
    // 3. We're on the login page
    // 4. We've attempted a login (prevents redirect on page load after logout)
    if (user?.userId && accessToken && location.pathname === '/admin/login' && hasAttemptedLogin) {
      console.log('[Login] User logged in:', user.role, user.userId);
      // Check if there's a redirect location from RouteGuard
      const from = (location.state as { from?: { pathname: string } })?.from;
      console.log('[Login] Redirect from:', from?.pathname);
      if (from?.pathname && from.pathname !== '/admin/login') {
        // Redirect to the original destination
        console.log('[Login] Redirecting to:', from.pathname);
        navigate(from.pathname, { replace: true });
      } else {
        // Default redirect to user's dashboard
        // Use doctorId for doctors, userId for other roles
        const adminId = user.role === 'Doctor' && user.doctorId ? user.doctorId : user.userId;
        console.log('[Login] Redirecting to default dashboard');
        navigate(`/admin/${adminId}`, { replace: true });
      }
    }
  }, [user, accessToken, navigate, location.state, location.pathname, hasAttemptedLogin]);

  // Removed widget debug/test loader on admin login page

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setHasAttemptedLogin(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message);
      setHasAttemptedLogin(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'username') setEmail(value);
    if (name === 'password') setPassword(value);
  };

  const values = { username: email, password };

  const featureCards = [
    {
      icon: CalendarIcon,
      title: t('Stay on top of your schedule'),
      body: t('Review upcoming visits, confirm appointments, and manage your day.'),
    },
    {
      icon: ReportsIcon,
      title: t('Clinical information at a glance'),
      body: t('Access labs, billing, and patient summaries without leaving the dashboard.'),
    },
    {
      icon: MessageIcon,
      title: t('Coordinate with your team'),
      body: t('Share updates with staff and keep patients informed through the portal.'),
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-12">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
              {t('Doctor portal')}
            </div>
            <div className="flex items-center gap-3">
              {logo ? (
                <img src={logo} alt={`${displayName} logo`} className="h-12 w-12 rounded object-contain shadow" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-lg font-semibold text-white shadow">
                  {displayName.charAt(0)}
                </div>
              )}
              <div>
                <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
                  {t('Welcome back to {name}', { name: displayName })}
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  {t('Access the admin workspace to manage patient care, appointments, and billing in one place.')}
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {featureCards.map((card) => {
                const Icon = card.icon;
                return (
                  <div key={card.title} className="rounded-2xl border border-blue-100 bg-white/80 p-4 shadow-sm backdrop-blur">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">{card.title}</p>
                        <p className="text-sm text-slate-500">{card.body}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="w-full max-w-xl justify-self-end rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
              {t('Doctor portal login')}
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-slate-900">{t('Sign in to your workspace')}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {t('Use your clinician credentials to access the admin portal and keep patient care moving.')}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="username" className="text-sm font-medium text-slate-700">
                  {t('Email or username')}
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  value={values.username}
                  onChange={handleChange}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>

              <div>
                <label htmlFor="password" className="text-sm font-medium text-slate-700">
                  {t('Password')}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  value={values.password}
                  onChange={handleChange}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>

              {error ? <p className="text-sm text-rose-600">{error}</p> : null}

              <button
                type="submit"
                className="flex w-full items-center justify-center rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                {t('Access admin portal')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
