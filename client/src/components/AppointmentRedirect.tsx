import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';

export default function AppointmentRedirect() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      // If not logged in, redirect to login
      navigate('/admin/login');
      return;
    }

    if (!id) {
      // If no appointment ID, redirect to appointments list
      navigate(`/admin/${user.userId}/appointments`);
      return;
    }

    // Redirect to the correct admin route format
    navigate(`/admin/${user.userId}/appointments/${id}`, { replace: true });
  }, [id, navigate, user]);

  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl bg-white p-10 text-center text-sm text-gray-500 shadow-sm">
      <span className="mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
      Redirecting to appointment...
    </div>
  );
}
