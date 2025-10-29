import axios from 'axios';

const ATENXION_API_URL = process.env.ATENXION_API_URL || 'https://api-qa.atenxion.ai';
const ATENXION_API_TOKEN = process.env.ATENXION_API_TOKEN;

// Simplified transaction function that only requires patientId and token
export async function recordAtenxionTransaction(
  patientId: string,
  token?: string | null
) {
  if (!ATENXION_API_TOKEN) {
    console.warn('ATENXION_API_TOKEN not configured, skipping transaction recording');
    return;
  }

  const url = `${ATENXION_API_URL}/api/post-login/new-transaction`;
  
  const body = {
    userId: patientId.trim()
  };
  
  const headers = { 
    Authorization: `Bearer ${token || ATENXION_API_TOKEN}`,
    'Content-Type': 'application/json'
  };
  
  try {
    console.log('Atenxion transaction API call:', {
      url,
      body,
      token: (token || ATENXION_API_TOKEN) ? `${(token || ATENXION_API_TOKEN).substring(0, 16)}...` : 'none',
    });
    
    const response = await axios.post(url, body, { headers });
    console.log('Transaction recorded successfully:', response.data);
    return true;
  } catch (error) {
    console.error('Transaction failed:', error);
    throw error;
  }
}
