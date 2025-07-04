import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, state } = req.query;

  if (!code) {
    console.error("Missing authorization code.");
    return res.status(400).json({ error: "Missing authorization code." });
  }

  try {
    const tokenResponse = await axios.post(
      "https://authorization.cerner.com/oauth2/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: "https://app.well-thread.com/api/callback/cerner",
        client_id: process.env.CERNER_CLIENT_ID ?? "",
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const tokens = tokenResponse.data;
    console.log("Cerner Token Response:", tokens);

    // TODO: Store tokens securely in your DB linked to the user session

    // Redirect to your app dashboard or success page
    return res.redirect("/success");
  } catch (error: any) {
    console.error("Token exchange failed:", error.response?.data || error.message);
    return res.status(500).json({ error: "Token exchange failed.", details: error.response?.data });
  }
}