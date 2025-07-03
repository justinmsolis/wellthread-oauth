import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code } = req.query;

  if (!code || typeof code !== "string") {
    return res.status(400).send("Error: Missing authorization code.");
  }

  try {
    const tokenRes = await axios.post(
      "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://api.well-thread.com/api/oauth-callback",
        client_id: "8d35c51b-441b-4e69-94b7-aa5ff8def968",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
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
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "response" in err &&
      err.response &&
      typeof err.response === "object" &&
      "data" in err.response
    ) {
      // @ts-expect-error response might not have type info but we ignore it safely
      console.error("❌ Token exchange error:", err.response.data);
    } else {
      console.error("❌ Token exchange error:", err);
    }
    res.status(500).send("Failed to exchange code for tokens.");
  }
}