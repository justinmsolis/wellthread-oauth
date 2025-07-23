import { NextResponse } from 'next/server';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Environment variables
const EPIC_TOKEN_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
const CLIENT_ID = process.env.EPIC_CLIENT_ID!;
const CLIENT_SECRET = process.env.EPIC_CLIENT_SECRET!;
const REDIRECT_URI = process.env.EPIC_REDIRECT_URI!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY!);

// Hardcoded Epic sandbox patients
const PATIENTS = {
  camila_lopez: {
    name: "Camila Lopez",
    fhir_id: "erXuFYUfucBZaryVksYEcMg3",
    external_id: "Z6129",
    mrn: "203713",
    username: "fhircamila",
    password: "epicepic1",
  },
  derrick_lin: {
    name: "Derrick Lin",
    fhir_id: "eq081-VQEgP8drUUqCWzHfw3",
    external_id: "Z6127",
    mrn: "203711",
    username: "fhirderrick",
    password: "epicepic1",
  },
  desiree_powell: {
    name: "Desiree Powell",
    fhir_id: "eAB3mDlBBcyUKviyzrxsnAw3",
    external_id: "Z6130",
    mrn: "203714",
    username: "fhirdesiree",
    password: "epicepic1",
  },
} as const;

// OAuth Callback Route
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (!code) {
    console.error('❌ Missing authorization code.');
    return NextResponse.redirect('https://app.well-thread.com/error');
  }

  try {
    // Exchange code for access token
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    const tokenResponse = await axios.post(EPIC_TOKEN_URL, params);
    const accessToken = tokenResponse.data.access_token;
    console.log('✅ OAuth token exchange successful');

    // Fetch Epic Patient resource to get their FHIR ID
    const patientResponse = await axios.get('https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/Patient', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    const patient = patientResponse.data;
    const patientFhirId = patient.id;
    const patientName = patient.name?.[0]?.text || `${patient.name?.[0]?.given?.[0] ?? 'Unknown'} ${patient.name?.[0]?.family ?? ''}`;
    console.log(`✅ Logged in as Epic patient: ${patientName} (FHIR ID: ${patientFhirId})`);

    // Match patientFhirId to a hardcoded patient
    const patientKey = Object.keys(PATIENTS).find(
      key => PATIENTS[key as keyof typeof PATIENTS].fhir_id === patientFhirId
    ) as keyof typeof PATIENTS | undefined;

    if (!patientKey) {
      console.warn(`⚠️ No matching sandbox patient found for FHIR ID ${patientFhirId}. Skipping resource fetch.`);
      return NextResponse.redirect('https://app.well-thread.com/HomeInsightsScreen');
    }

    await fetchAndSavePatientResources(patientKey, accessToken);

    return NextResponse.redirect('https://app.well-thread.com/HomeInsightsScreen');
  } catch (error: any) {
    console.error('❌ OAuth flow failed:', error.response?.data || error.message);
    return NextResponse.redirect('https://app.well-thread.com/error');
  }
}

// Fetch and Save Resources for Patient
async function fetchAndSavePatientResources(patientKey: keyof typeof PATIENTS, accessToken: string) {
  const patient = PATIENTS[patientKey];
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };

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
    { type: "Immunization", table: "immunizations" }
  ];

  for (const { type, table } of resourceTypes) {
    console.log(`🔄 Fetching ${type} for ${patient.name}...`);

    const data = await fetchEpicResource(type, headers);
    const entries = data?.entry || [];

    console.log(`📦 ${entries.length} ${type} entries returned from Epic`);

    if (entries.length > 0) {
      const parsed = entries.map((item: any) => ({
        id: item.resource.id || item.fullUrl || uuidv4(),
        patient_fhir_id: patient.fhir_id,
        resource_data: item.resource,
        status: item.resource.status || null,
        created_at: new Date().toISOString()
      }));

      const { error } = await supabase.from(table).upsert(parsed, { onConflict: 'id' });

      if (error) {
        console.error(`❌ Supabase upsert failed for ${type}:`, error);
      } else {
        console.log(`✅ Supabase upsert succeeded: ${parsed.length} ${type} for ${patient.name}`);
      }
    } else {
      console.warn(`⚠️ No entries to upsert for ${type}. Table may remain empty.`);
    }
  }
}

// Fetch Resource Helper
async function fetchEpicResource(resourceType: string, headers: any) {
  let url = `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/${resourceType}`;
  if (resourceType === 'Observation') {
    url += '?category=laboratory';
  }

  try {
    const response = await axios.get(url, { headers });
    console.log(`✅ Fetched ${resourceType}: ${response.data?.entry?.length || 0} entries`);
    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to fetch ${resourceType}:`, error.response?.data || error.message);
    return null;
  }
}











