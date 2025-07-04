import { NextRequest, NextResponse } from "next/server";

// Read your environment variables at the top
const clientId = process.env.EPIC_CLIENT_ID!;
const clientSecret = process.env.EPIC_CLIENT_SECRET!;
const redirectUri = process.env.EPIC_REDIRECT_URI!;

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    console.error("Epic returned an error:", error);
    return NextResponse.redirect("/error?reason=" + error);
  }

  if (!code) {
    console.error("No code found in Epic redirect");
    return NextResponse.redirect("/error?reason=missing_code");
  }

  const tokenEndpoint = "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token";

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("Failed to exchange code:", errorText);
    return NextResponse.redirect("/error?reason=token_exchange_failed");
  }

  const tokenResponse = await res.json();
  console.log("Tokens received:", tokenResponse);

  // TODO: Store tokens securely
  return NextResponse.redirect("/success");
}