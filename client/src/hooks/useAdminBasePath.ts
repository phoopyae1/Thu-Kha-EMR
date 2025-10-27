import { useParams } from 'react-router-dom';

export default function useAdminBasePath() {
  const { adminId } = useParams<{ adminId: string }>();
  return adminId ? `/admin/${adminId}` : '/admin';
}
