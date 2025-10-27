import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import PatientPortal from '../pages/PatientPortal';

export default function PatientRedirect() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const { user, accessToken } = useAuth();

  useEffect(() => {
    // If user is logged in as a doctor/admin, redirect to admin interface
    if (accessToken && user) {
      console.log('PatientRedirect: Redirecting to admin interface', {
        userId: user.userId,
        patientId,
        role: user.role
      });
      navigate(`/admin/${user.userId}/patients/${patientId}`, { replace: true });
    } else {
      console.log('PatientRedirect: No auth, showing patient portal', {
        hasAccessToken: !!accessToken,
        hasUser: !!user
      });
    }
  }, [accessToken, user, patientId, navigate]);

  // If not logged in or is a patient, show patient portal
  return <PatientPortal />;
}
