import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// =============================================
// HEALTH DATA COLLECTION ENDPOINTS
// =============================================

// POST /api/wellness/data - Create new health data entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      userId, 
      goalId, 
      dataType, 
      data, 
      date, 
      source = 'manual', 
      tags = [] 
    } = body

    // Validate required fields
    if (!userId || !dataType || !data) {
      return NextResponse.json(
        { error: 'userId, dataType, and data are required' }, 
        { status: 400 }
      )
    }

    // Validate dataType
    const validDataTypes = [
      'sleep', 'stress', 'nutrition', 'exercise', 'headache', 
      'weather', 'blood_pressure', 'mood', 'hydration', 
      'medication', 'symptoms', 'vitals', 'custom'
    ]
    
    if (!validDataTypes.includes(dataType)) {
      return NextResponse.json(
        { error: `Invalid dataType. Must be one of: ${validDataTypes.join(', ')}` }, 
        { status: 400 }
      )
    }

    // Prepare data for insertion
    const insertData = {
      user_id: userId,
      goal_id: goalId || null,
      data_type: dataType,
      date: date ? new Date(date).toISOString() : new Date().toISOString(),
      data: data,
      source: source,
      tags: tags,
      is_private: false,
      // Store structured data based on type
      [`${dataType}_data`]: data
    }

    // Insert health data
    const { data: healthData, error } = await supabase
      .from('health_data')
      .insert([insertData])
      .select()
      .single()

    if (error) {
      console.error('Error creating health data:', error)
      return NextResponse.json(
        { error: 'Failed to save health data' }, 
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Health data saved successfully',
      data: healthData
    })

  } catch (error) {
    console.error('Health data API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// GET /api/wellness/data - Get health data with filtering
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const goalId = searchParams.get('goalId')
    const dataType = searchParams.get('dataType')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const limit = parseInt(searchParams.get('limit') || '50')
    const page = parseInt(searchParams.get('page') || '1')

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' }, 
        { status: 400 }
      )
    }

    // Build query
    let query = supabase
      .from('health_data')
      .select(`
        *,
        health_goals!inner(id, title, category)
      `)
      .eq('user_id', userId)

    if (goalId) query = query.eq('goal_id', goalId)
    if (dataType) query = query.eq('data_type', dataType)
    if (startDate) query = query.gte('date', new Date(startDate).toISOString())
    if (endDate) query = query.lte('date', new Date(endDate).toISOString())

    // Add pagination
    const offset = (page - 1) * limit
    query = query
      .order('date', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data, error, count } = await query

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
      pagination: {
        current: page,
        pages: Math.ceil((count || 0) / limit),
        total: count || 0,
        limit: limit
      }
    })

  } catch (error) {
    console.error('Health data fetch error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// PUT /api/wellness/data/[id] - Update health data entry
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, data, date, tags } = body

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' }, 
        { status: 400 }
      )
    }

    const updates: any = {}
    if (data !== undefined) updates.data = data
    if (date !== undefined) updates.date = new Date(date).toISOString()
    if (tags !== undefined) updates.tags = tags

    const { data: healthData, error } = await supabase
      .from('health_data')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating health data:', error)
      return NextResponse.json(
        { error: 'Failed to update health data' }, 
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Health data updated successfully',
      data: healthData
    })

  } catch (error) {
    console.error('Health data update error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// DELETE /api/wellness/data/[id] - Delete health data entry
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' }, 
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('health_data')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting health data:', error)
      return NextResponse.json(
        { error: 'Failed to delete health data' }, 
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Health data deleted successfully'
    })

  } catch (error) {
    console.error('Health data delete error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}