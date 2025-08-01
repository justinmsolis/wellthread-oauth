import { NextResponse } from 'next/server';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// -----------------------------------------------------------------------------
// Environment variables
// -----------------------------------------------------------------------------
const EPIC_BASE = 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';
const EPIC_TOKEN_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
const CLIENT_ID = process.env.EPIC_CLIENT_ID!;
const CLIENT_SECRET = process.env.EPIC_CLIENT_SECRET!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY!);

// -----------------------------------------------------------------------------
// Epic OAuth Configuration
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// OAuth Callback Route - Handles both web redirects and iOS app calls
// -----------------------------------------------------------------------------
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const codeVerifier = url.searchParams.get('code_verifier');
  const isIOSApp = url.searchParams.get('ios_app') === 'true';

  if (!code) {
    console.error('❌ Missing authorization code.');
    if (isIOSApp) {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
    } else {
      return NextResponse.redirect('https://app.well-thread.com/error');
    }
  }

  try {
    console.log('🔍 Epic OAuth callback received:');
    console.log('   - code:', code.substring(0, 20) + '...');
    console.log('   - code_verifier:', codeVerifier ? codeVerifier.substring(0, 20) + '...' : 'none');
    console.log('   - isIOSApp:', isIOSApp);

    // 1. Exchange code for access token
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'formfiller://epic-oauth-callback', // Use the same redirect URI as iOS app
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    // Add code_verifier if provided (for PKCE)
    if (codeVerifier) {
      params.append('code_verifier', codeVerifier);
    }

    console.log('🔍 Sending to Epic:');
    console.log('   - URL:', EPIC_TOKEN_URL);
    console.log('   - params:', params.toString());

    const tokenResponse = await axios.post(EPIC_TOKEN_URL, params);
    const tokenData = tokenResponse.data;
    const accessToken: string = tokenData.access_token;
    console.log('✅ OAuth token exchange successful');

    // 2. Extract patient FHIR ID from token response
    let patientFhirId: string | undefined = tokenData.patient || tokenData.patient_id;

    // 3. If still missing, try to decode id_token (if present) to look for a `patient` claim
    if (!patientFhirId && tokenData.id_token) {
      try {
        const payload = JSON.parse(
          Buffer.from(tokenData.id_token.split('.')[1], 'base64').toString('utf8')
        );
        patientFhirId = payload.patient || payload.fhir_patient || payload.sub;
        console.log('ℹ️ Extracted patient ID from id_token payload:', patientFhirId);
      } catch (e) {
        console.warn('⚠️ Could not parse id_token for patient ID.', e);
      }
    }

    if (!patientFhirId) {
      console.warn('⚠️ Token response did not include a patient ID. tokenData=', tokenData);
      if (isIOSApp) {
        return NextResponse.json({ error: 'No patient ID found' }, { status: 400 });
      } else {
        return NextResponse.redirect('https://app.well-thread.com/');
      }
    }

    // 4. Fetch the full Patient resource
    const patientResource = await fetchEpicPatient(patientFhirId, accessToken);
    const patientName =
      patientResource?.name?.[0]?.text ||
      [
        patientResource?.name?.[0]?.given?.[0] ?? 'Unknown',
        patientResource?.name?.[0]?.family ?? '',
      ].join(' ').trim();

    console.log(`✅ Logged in as Epic patient: ${patientName} (FHIR ID: ${patientFhirId})`);

    // 5. Look up patient in Supabase
    const { data: patientData, error: patientError } = await supabase
      .from('patients')
      .select('*')
      .eq('patient_fhir_id', patientFhirId)
      .single();

    if (patientError || !patientData) {
      console.warn(`⚠️ No matching patient found in Supabase for FHIR ID ${patientFhirId}. Skipping resource fetch.`);
      if (isIOSApp) {
        return NextResponse.json({ 
          success: true,
          access_token: accessToken,
          patient_id: patientFhirId,
          patient_info: { id: patientFhirId, name: patientName },
          message: 'Epic authentication successful! You can now use the chatbot.'
        });
      } else {
        return NextResponse.redirect('https://app.well-thread.com/');
      }
    }

    // Extract patient info from resource_data
    const patientResourceData = patientData.resource_data;
    const finalPatientName = patientResourceData?.name?.[0]?.text || patientName;

    console.log(`✅ Found patient in Supabase: ${finalPatientName} (${patientFhirId})`);

    // 6. Fetch & save clinical data
    await fetchAndSavePatientResources(patientData, accessToken);

    // Return appropriate response based on caller
    if (isIOSApp) {
      return NextResponse.json({
        success: true,
        access_token: accessToken,
        patient_id: patientFhirId,
        patient_info: { id: patientFhirId, name: finalPatientName },
        message: 'Epic authentication successful! You can now use the chatbot.'
      });
    } else {
      return NextResponse.redirect('https://app.well-thread.com/');
    }

  } catch (error: any) {
    console.error('❌ OAuth flow failed:', error.response?.data || error.message);
    if (isIOSApp) {
      return NextResponse.json({ 
        error: 'Epic authentication failed',
        details: error.response?.data || error.message
      }, { status: 400 });
    } else {
      return NextResponse.redirect('https://app.well-thread.com/error');
    }
  }
}

// -----------------------------------------------------------------------------
// Fetch and Save Resources for Patient
// -----------------------------------------------------------------------------
async function fetchAndSavePatientResources(
  patientData: any,
  accessToken: string
) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/fhir+json',
  };

  console.log(`🔍 Fetching resources for patient: ${patientData.resource_data?.name?.[0]?.text || 'Unknown'} (${patientData.patient_fhir_id})`);

  // NOTE: These are broad pulls; we'll refine with ?patient= search params later.
  const resourceTypes = [
    { type: "MedicationRequest", table: "medication_requests" },
    { type: "Medication", table: "medications" },
    { type: "MedicationStatement", table: "medication_statements" },
    { type: "Observation", table: "observations" },
    { type: "DiagnosticReport", table: "diagnostic_reports" },
    { type: "Procedure", table: "procedures" },
    { type: "Goal", table: "goals" },
    { type: "Condition", table: "conditions" },
    { type: "CarePlan", table: "careplans" },
    { type: "Immunization", table: "immunizations" },
  ];

  for (const { type, table } of resourceTypes) {
    const patientName = patientData.resource_data?.name?.[0]?.text || 'Unknown';
    console.log(`🔄 Fetching ${type} for ${patientName}...`);

    // IMPORTANT: Use patient search param to limit results to this patient
    const data = await fetchEpicResource(type, headers, patientData.patient_fhir_id);
    const entries = data?.entry || [];

    console.log(`📦 ${entries.length} ${type} entries returned from Epic for ${patientName}`);

    // Always upsert even if empty (parsing happens only when entries > 0)
    if (entries.length > 0) {
      const parsed = entries.map((item: any) => ({
        id: item.resource.id || item.fullUrl || uuidv4(),
        patient_fhir_id: patientData.patient_fhir_id,
        resource_data: item.resource,
        status: (item.resource as any).status || null,
        created_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from(table).upsert(parsed, { onConflict: 'id' });

      if (error) {
        console.error(`❌ Supabase upsert failed for ${type}:`, error);
      } else {
        console.log(`✅ Supabase upsert succeeded: ${parsed.length} ${type} for ${patientName}`);
      }
    } else {
      console.warn(`⚠️ No entries to upsert for ${type}. Table may remain empty.`);
    }
  }
}

// -----------------------------------------------------------------------------
// Epic API: Fetch Patient resource by ID
// -----------------------------------------------------------------------------
async function fetchEpicPatient(patientId: string, accessToken: string) {
  const url = `${EPIC_BASE}/Patient/${encodeURIComponent(patientId)}`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/fhir+json',
      },
    });
    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to fetch Patient/${patientId}:`, error.response?.data || error.message);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Generic Epic resource fetch (filtered by patient when possible)
// -----------------------------------------------------------------------------
async function fetchEpicResource(
  resourceType: string,
  headers: Record<string, string>,
  patientId?: string
) {
  // Base
  let url = `${EPIC_BASE}/${resourceType}`;

  // Attach patient search param if provided & supported
  // Most resources support ?patient=; Observations may also include category filters.
  const params = new URLSearchParams();
  if (patientId) params.set('patient', patientId);
  if (resourceType === 'Observation') {
    // Pull common lab category; you can remove or expand later
    params.set('category', 'laboratory');
  }
  const qs = params.toString();
  if (qs) url += `?${qs}`;

  try {
    const response = await axios.get(url, { headers });
    console.log(`✅ Fetched ${resourceType}: ${(response.data?.entry?.length ?? 0)} entries`);
    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to fetch ${resourceType}:`, error.response?.data || error.message);
    return null;
  }
} 










