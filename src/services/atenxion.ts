import axios from "axios";
import { fetchLatestIntegrationEmbed, fetchLatestAdminIntegrationEmbed } from "./localMongoService.js";

const ATENXION_API_URL =
  process.env.ATENXION_API_URL || "https://backend.atenxion.ai";
const ATENXION_API_TOKEN = process.env.ATENXION_API_TOKEN || "asdf";

// Simplified transaction function that only requires patientId and token
export async function recordAtenxionTransaction(
  patientId: string,
  token?: string | null
) {
  const url = `${ATENXION_API_URL}/api/post-login/new-transaction`;

  const body = {
    userId: patientId.trim(),
  };

  let atenxionToken = "";
  try {
    const latest = await fetchLatestIntegrationEmbed();
    const embeddedToken = (latest as any)?.contextKey as string | undefined;
    if (embeddedToken && embeddedToken.trim().length > 0) {
      atenxionToken = embeddedToken.trim();
    }
  } catch {
    atenxionToken = "asdf";
  }

  const headers = {
    Authorization: `${atenxionToken || ATENXION_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    console.log("Atenxion transaction API call:", {
      url,
      body,
      token:
        atenxionToken || ATENXION_API_TOKEN
          ? `${(atenxionToken || ATENXION_API_TOKEN).substring(0, 16)}...`
          : "none",
    });

    const response = await axios.post(url, body, { headers });
    console.log("Transaction recorded successfully:", response.data);
    return true;
  } catch (error) {
    console.error("Transaction failed:", error);
    throw error;
  }
}

// Transaction function for doctors that uses doctorId as userId
export async function recordAtenxionTransactionForDoctor(
  doctorId: string,
  token?: string | null
) {
  const url = `${ATENXION_API_URL}/api/post-login/new-transaction`;

  const body = {
    userId: doctorId.trim(),
  };

  let atenxionToken = "";
  try {
    // Fetch doctor-specific integration embed
    const latest = await fetchLatestAdminIntegrationEmbed('Doctor');
    const embeddedToken = (latest as any)?.contextKey as string | undefined;
    if (embeddedToken && embeddedToken.trim().length > 0) {
      atenxionToken = embeddedToken.trim();
    }
  } catch {
    atenxionToken = "asdf";
  }

  const headers = {
    Authorization: `${atenxionToken || ATENXION_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    console.log("Atenxion transaction API call (Doctor):", {
      url,
      body,
      token:
        atenxionToken || ATENXION_API_TOKEN
          ? `${(atenxionToken || ATENXION_API_TOKEN).substring(0, 16)}...`
          : "none",
    });

    const response = await axios.post(url, body, { headers });
    console.log("Transaction recorded successfully for doctor:", response.data);
    return true;
  } catch (error) {
    console.error("Transaction failed for doctor:", error);
    throw error;
  }
}
