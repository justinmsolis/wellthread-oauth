import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new NextResponse('Error: Missing authorization code.', { status: 400 });
  }

  console.log('✅ Received authorization code from Epic:', code);

  return new NextResponse(
    `<html><body><h1>✅ OAuth Callback Received</h1><p>Authorization code received: ${code}</p></body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}
