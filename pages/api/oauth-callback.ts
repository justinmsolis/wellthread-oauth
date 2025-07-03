import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code } = req.query; // Removed unused 'state'

  if (!code || typeof code !== "string") {
    return res.status(400).send("Error: Missing authorization code.");
  }

  try {
    const tokenRes = await axios.post(
      "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://api.well-thread.com/api/oauth-callback", // must match Epic registration
        client_id: "8d35c51b-441b-4e69-94b7-aa5ff8def968",             // your sandbox client ID
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const tokens = tokenRes.data;
    console.log("✅ Epic tokens received:", tokens);

    // 🔴 TODO: Save tokens tied to your user in your database (e.g., Supabase)

    res.send(`
      <html>
        <body>
          <h1>✅ Epic connected successfully!</h1>
          <p>You can now return to the WellThread app.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(
      "❌ Token exchange error:",
      (err as any)?.response?.data || (err as any)?.message
    );
    res.status(500).send("Failed to exchange code for tokens.");
  }
}