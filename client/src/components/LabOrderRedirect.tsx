import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';

export default function LabOrderRedirect() {
  const { labOrderId } = useParams<{ labOrderId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      navigate('/admin/login');
      return;
    }

    if (!labOrderId) {
      navigate(`/admin/${user.userId}/lab-orders`);
      return;
    }

    navigate(`/admin/${user.userId}/lab-orders/${labOrderId}`, { replace: true });
  }, [labOrderId, navigate, user]);

  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl bg-white p-10 text-center text-sm text-gray-500 shadow-sm">
      <span className="mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
      Redirecting to lab order...
    </div>
  );
}


