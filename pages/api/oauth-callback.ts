import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code } = req.query;

  if (!code || typeof code !== "string") {
    return res.status(400).send("Error: Missing authorization code.");
  }

  const clientId = process.env.EPIC_CLIENT_ID!;
  const clientSecret = process.env.EPIC_CLIENT_SECRET!;
  const redirectUri = process.env.EPIC_REDIRECT_URI!;

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const tokenRes = await axios.post(
      "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,   // Should match your proxy redirect URI
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,   // 🔥 This is the key fix
        },
      }
    );

    const tokens = tokenRes.data;
    console.log("✅ Epic tokens received:", tokens);

    res.send(`
      <html>
        <body>
          <h1>✅ Epic connected successfully!</h1>
          <p>You can now return to the WellThread app.</p>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("❌ Token exchange error:", err?.response?.data || err.message);
    res.status(500).send("Failed to exchange code for tokens.");
  }
}
