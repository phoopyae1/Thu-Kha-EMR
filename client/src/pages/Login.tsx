import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import LoginCard from '../components/LoginCard';
import PageLayout from '../components/PageLayout';
import { useSettings } from '../context/SettingsProvider';
import { useTranslation } from '../hooks/useTranslation';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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
    <PageLayout maxWidth="max-w-sm">
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
    </PageLayout>
  );
}
