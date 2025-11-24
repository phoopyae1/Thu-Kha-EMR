import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import LoginCard from '../components/LoginCard';
import PageLayout from '../components/PageLayout';
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

  return (
    <PageLayout maxWidth="max-w-md">
      <div className="flex flex-col items-center justify-center">
        {error && (
          <div className="mb-4 w-full rounded-md bg-red-100 p-2 text-sm text-red-700">
            {error}
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
    </PageLayout>
  );
}
