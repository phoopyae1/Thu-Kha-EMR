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

// Transaction function for cashiers that uses cashierId (userId) as userId
export async function recordAtenxionTransactionForCashier(
  cashierId: string,
  token?: string | null
) {
  const url = `${ATENXION_API_URL}/api/post-login/new-transaction`;

  const body = {
    userId: cashierId.trim(),
  };

  let atenxionToken = "";
  try {
    // Fetch cashier-specific integration embed
    const latest = await fetchLatestAdminIntegrationEmbed('Cashier');
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
    console.log("Atenxion transaction API call (Cashier):", {
      url,
      body,
      token:
        atenxionToken || ATENXION_API_TOKEN
          ? `${(atenxionToken || ATENXION_API_TOKEN).substring(0, 16)}...`
          : "none",
    });

    const response = await axios.post(url, body, { headers });
    console.log("Transaction recorded successfully for cashier:", response.data);
    return true;
  } catch (error) {
    console.error("Transaction failed for cashier:", error);
    throw error;
  }
}

// Transaction function for admins (ITAdmin) that uses adminId (userId) as userId
export async function recordAtenxionTransactionForAdmin(
  adminId: string,
  token?: string | null
) {
  const url = `${ATENXION_API_URL}/api/post-login/new-transaction`;

  const body = {
    userId: adminId.trim(),
  };

  let atenxionToken = "";
  try {
    // Fetch admin-specific integration embed
    const latest = await fetchLatestAdminIntegrationEmbed('ITAdmin');
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
    console.log("Atenxion transaction API call (Admin):", {
      url,
      body,
      token:
        atenxionToken || ATENXION_API_TOKEN
          ? `${(atenxionToken || ATENXION_API_TOKEN).substring(0, 16)}...`
          : "none",
    });

    const response = await axios.post(url, body, { headers });
    console.log("Transaction recorded successfully for admin:", response.data);
    return true;
  } catch (error) {
    console.error("Transaction failed for admin:", error);
    throw error;
  }
}

// Transaction function for lab techs (LabTech) that uses labTechId (userId) as userId
export async function recordAtenxionTransactionForLabTech(
  labTechId: string,
  token?: string | null
) {
  const url = `${ATENXION_API_URL}/api/post-login/new-transaction`;

  const body = {
    userId: labTechId.trim(),
  };

  let atenxionToken = "";
  try {
    // Fetch lab tech-specific integration embed
    const latest = await fetchLatestAdminIntegrationEmbed('LabTech');
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
    console.log("Atenxion transaction API call (LabTech):", {
      url,
      body,
      token:
        atenxionToken || ATENXION_API_TOKEN
          ? `${(atenxionToken || ATENXION_API_TOKEN).substring(0, 16)}...`
          : "none",
    });

    const response = await axios.post(url, body, { headers });
    console.log("Transaction recorded successfully for lab tech:", response.data);
    return true;
  } catch (error) {
    console.error("Transaction failed for lab tech:", error);
    throw error;
  }
}

// Transaction function for pharmacists (Pharmacist) that uses pharmacistId (userId) as userId
export async function recordAtenxionTransactionForPharmacist(
  pharmacistId: string,
  token?: string | null
) {
  const url = `${ATENXION_API_URL}/api/post-login/new-transaction`;

  const body = {
    userId: pharmacistId.trim(),
  };

  let atenxionToken = "";
  try {
    // Fetch pharmacist-specific integration embed
    const latest = await fetchLatestAdminIntegrationEmbed('Pharmacist');
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
    console.log("Atenxion transaction API call (Pharmacist):", {
      url,
      body,
      token:
        atenxionToken || ATENXION_API_TOKEN
          ? `${(atenxionToken || ATENXION_API_TOKEN).substring(0, 16)}...`
          : "none",
    });

    const response = await axios.post(url, body, { headers });
    console.log("Transaction recorded successfully for pharmacist:", response.data);
    return true;
  } catch (error) {
    console.error("Transaction failed for pharmacist:", error);
    throw error;
  }
}
