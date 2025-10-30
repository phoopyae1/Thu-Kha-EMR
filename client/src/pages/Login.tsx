import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  // Removed success toast; we redirect on successful login
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const { appName, logo } = useSettings();
  const { t } = useTranslation();

  // Handle redirect after successful login
  useEffect(() => {
    if (user?.userId) {
      navigate(`/admin/${user.userId}`);
    }
  }, [user, navigate]);

  // Removed widget debug/test loader on admin login page

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
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
