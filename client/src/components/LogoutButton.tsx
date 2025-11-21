import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';

interface Props {
  className?: string;
}

export default function LogoutButton({
  className = 'rounded bg-gray-200 px-4 py-2 text-gray-700 hover:bg-gray-300',
}: Props) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function handleClick() {
    await logout();
    // Refresh the page to ensure clean state
    // Check if we're in admin routes or patient routes
    if (location.pathname.startsWith('/admin')) {
      window.location.href = '/admin/login';
    } else {
      window.location.href = '/login';
    }
  }

  return (
    <button type="button" onClick={handleClick} className={className}>
      Logout
    </button>
  );
}
