import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

// =============================================
// HEALTH DATA COLLECTION ENDPOINTS
// =============================================

// POST /api/wellness/data - Log health data
export async function POST(request: NextRequest) {
  try {
    // Check if Supabase is configured
    if (!supabase) {
      return NextResponse.json(
        { error: 'Supabase not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.' }, 
        { status: 500 }
      )
    }

    const body = await request.json()
    console.log('📥 Received health data request:', JSON.stringify(body, null, 2))
    
    const { userId, dataType, value, unit, notes, goalId, timestamp } = body

    if (!userId || !dataType || value === undefined) {
      return NextResponse.json(
        { error: 'userId, dataType, and value are required' }, 
        { status: 400 }
      )
    }

    // Insert health data
    const { data, error } = await supabase
      .from('health_data')
      .insert({
        user_id: userId,
        data_type: dataType,
        data: value,  // Map 'value' to 'data' column
        unit: unit || null,
        notes: notes || null,
        goal_id: goalId || null,
        date: timestamp || new Date().toISOString(),
        source: 'manual',
        tags: [],
        is_private: false
      })
      .select()

    if (error) {
      console.error('❌ Database error:', JSON.stringify(error, null, 2))
      console.error('❌ Error details:', error.message, error.details, error.hint)
      return NextResponse.json(
        { error: 'Failed to save health data', details: error.message }, 
        { status: 500 }
      )
    }

    const response = {
      success: true,
      data: data,  // Return array as expected by frontend
      message: 'Health data saved successfully'
    }
    
    console.log('✅ Successfully saved health data:', JSON.stringify(response, null, 2))
    
    return NextResponse.json(response)

  } catch (error) {
    console.error('Health data error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// GET /api/wellness/data - Get health data
export async function GET(request: NextRequest) {
  try {
    // Check if Supabase is configured
    if (!supabase) {
      return NextResponse.json(
        { error: 'Supabase not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.' }, 
        { status: 500 }
      )
    }

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const goalId = searchParams.get('goalId')
    const dataType = searchParams.get('dataType')
    const limit = parseInt(searchParams.get('limit') || '100')
    const days = parseInt(searchParams.get('days') || '30')

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' }, 
        { status: 400 }
      )
    }

    // Calculate date range
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    let query = supabase
      .from('health_data')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(limit)

    if (goalId) {
      query = query.eq('goal_id', goalId)
    }

    if (dataType) {
      query = query.eq('data_type', dataType)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching health data:', error)
      return NextResponse.json(
        { error: 'Failed to fetch health data' }, 
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: data || [],
      count: data?.length || 0,
      period: `${days} days`
    })

  } catch (error) {
    console.error('Health data fetch error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}
