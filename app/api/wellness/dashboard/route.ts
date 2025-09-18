import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// =============================================
// DASHBOARD ENDPOINTS
// =============================================

// GET /api/wellness/dashboard - Get user dashboard data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' }, 
        { status: 400 }
      )
    }

    // Get user profile
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, last_login')
      .eq('id', userId)
      .single()

    if (userError) {
      console.error('Error fetching user:', userError)
      return NextResponse.json(
        { error: 'User not found' }, 
        { status: 404 }
      )
    }

    // Get active goals
    const { data: activeGoals, error: goalsError } = await supabase
      .from('health_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(5)

    if (goalsError) {
      console.error('Error fetching goals:', goalsError)
      return NextResponse.json(
        { error: 'Failed to fetch goals' }, 
        { status: 500 }
      )
    }

    // Get recent health data (last 7 days)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: recentData, error: dataError } = await supabase
      .from('health_data')
      .select(`
        *,
        health_goals!inner(id, title, category)
      `)
      .eq('user_id', userId)
      .gte('date', sevenDaysAgo.toISOString())
      .order('date', { ascending: false })
      .limit(20)

    if (dataError) {
      console.error('Error fetching recent data:', dataError)
      return NextResponse.json(
        { error: 'Failed to fetch recent data' }, 
        { status: 500 }
      )
    }

    // Calculate dashboard stats
    const [completedGoalsCount, totalDataEntries] = await Promise.all([
      getCompletedGoalsCount(userId),
      getTotalDataEntries(userId)
    ])

    // Get data summary for the last 30 days
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: summaryData, error: summaryError } = await supabase
      .from('health_data')
      .select('*')
      .eq('user_id', userId)
      .gte('date', thirtyDaysAgo.toISOString())

    if (summaryError) {
      console.error('Error fetching summary data:', summaryError)
      return NextResponse.json(
        { error: 'Failed to fetch summary data' }, 
        { status: 500 }
      )
    }

    // Process summary data
    const dataSummary = processDataSummary(summaryData || [])

    const stats = {
      totalGoals: activeGoals?.length || 0,
      completedGoals: completedGoalsCount,
      totalDataEntries,
      recentEntries: recentData?.length || 0,
      lastLogin: user.last_login,
      dataSummary
    }

    return NextResponse.json({
      success: true,
      dashboard: {
        user: {
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          lastLogin: user.last_login
        },
        stats,
        activeGoals: activeGoals || [],
        recentData: recentData?.slice(0, 10) || [] // Limit to 10 most recent
      }
    })

  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// GET /api/wellness/dashboard/summary - Get data summary for dashboard
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const days = parseInt(searchParams.get('days') || '30')

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' }, 
        { status: 400 }
      )
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Get health data for summary
    const { data: healthData, error } = await supabase
      .from('health_data')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate.toISOString())
      .order('date', { ascending: false })

    if (error) {
      console.error('Error fetching summary data:', error)
      return NextResponse.json(
        { error: 'Failed to fetch summary data' }, 
        { status: 500 }
      )
    }

    // Process data summary
    const summary = processDataSummary(healthData || [])

    return NextResponse.json({
      success: true,
      summary,
      period: `${days} days`,
      dataPoints: healthData?.length || 0
    })

  } catch (error) {
    console.error('Dashboard summary error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// =============================================
// HELPER FUNCTIONS
// =============================================

async function getCompletedGoalsCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('health_goals')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'completed')

  if (error) {
    console.error('Error counting completed goals:', error)
    return 0
  }

  return count || 0
}

async function getTotalDataEntries(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('health_data')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (error) {
    console.error('Error counting data entries:', error)
    return 0
  }

  return count || 0
}

function processDataSummary(healthData: any[]) {
  // Group data by type
  const dataByType: any = {}
  healthData.forEach(entry => {
    if (!dataByType[entry.data_type]) {
      dataByType[entry.data_type] = []
    }
    dataByType[entry.data_type].push(entry)
  })

  // Calculate summary for each data type
  const summary = {
    totalEntries: healthData.length,
    dataTypes: Object.keys(dataByType).length,
    dataByType: Object.entries(dataByType).map(([type, data]: [string, any]) => ({
      type,
      count: data.length,
      latestDate: data[0]?.date, // Most recent entry
      data: data.slice(0, 5) // Latest 5 entries
    })),
    recentEntries: healthData.slice(0, 10) // Latest 10 entries
  }

  return summary
}