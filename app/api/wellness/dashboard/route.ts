import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// =============================================
// DASHBOARD ENDPOINTS
// =============================================

// GET /api/wellness/dashboard - Get dashboard data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const goalId = searchParams.get('goalId')
    const endpoint = searchParams.get('endpoint') || 'overview'

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' }, 
        { status: 400 }
      )
    }

    // Route to different dashboard functions based on endpoint
    switch (endpoint) {
      case 'overview':
        return await getDashboardOverview(userId, goalId)
      case 'summary':
        return await getDashboardSummary(userId, goalId)
      default:
        return await getDashboardOverview(userId, goalId)
    }

  } catch (error) {
    console.error('Dashboard error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

async function getDashboardOverview(userId: string, goalId: string | null) {
  // Get user's health goals
  const { data: goals, error: goalsError } = await supabase
    .from('health_goals')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (goalsError) {
    console.error('Error fetching goals:', goalsError)
    return NextResponse.json(
      { error: 'Failed to fetch health goals' }, 
      { status: 500 }
    )
  }

  // Get recent health data
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: healthData, error: dataError } = await supabase
    .from('health_data')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', thirtyDaysAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(100)

  if (dataError) {
    console.error('Error fetching health data:', dataError)
    return NextResponse.json(
      { error: 'Failed to fetch health data' }, 
      { status: 500 }
    )
  }

  // Filter by goal if specified
  let filteredData = healthData
  if (goalId) {
    filteredData = healthData?.filter(item => item.goal_id === goalId) || []
  }

  // Calculate dashboard metrics
  const metrics = calculateDashboardMetrics(filteredData || [], goals || [])

  return NextResponse.json({
    success: true,
    goals: goals || [],
    recentData: filteredData?.slice(0, 10) || [],
    metrics,
    lastUpdated: new Date().toISOString()
  })
}

async function getDashboardSummary(userId: string, goalId: string | null) {
  // Get comprehensive dashboard summary
  const { data: goals, error: goalsError } = await supabase
    .from('health_goals')
    .select('*')
    .eq('user_id', userId)

  if (goalsError) {
    console.error('Error fetching goals:', goalsError)
    return NextResponse.json(
      { error: 'Failed to fetch health goals' }, 
      { status: 500 }
    )
  }

  // Get health data for the last 90 days
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  const { data: healthData, error: dataError } = await supabase
    .from('health_data')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', ninetyDaysAgo.toISOString())

  if (dataError) {
    console.error('Error fetching health data:', dataError)
    return NextResponse.json(
      { error: 'Failed to fetch health data' }, 
      { status: 500 }
    )
  }

  // Filter by goal if specified
  let filteredData = healthData
  if (goalId) {
    filteredData = healthData?.filter(item => item.goal_id === goalId) || []
  }

  // Calculate comprehensive summary
  const summary = calculateComprehensiveSummary(filteredData || [], goals || [])

  return NextResponse.json({
    success: true,
    summary,
    dataPoints: filteredData?.length || 0,
    period: '90 days'
  })
}

function calculateDashboardMetrics(data: any[], goals: any[]) {
  const dataTypes = [...new Set(data.map(item => item.data_type))]
  const activeGoals = goals.filter(goal => goal.status === 'active')
  
  return {
    totalDataPoints: data.length,
    dataTypes: dataTypes.length,
    activeGoals: activeGoals.length,
    lastEntry: data.length > 0 ? data[0].created_at : null,
    completionRate: calculateCompletionRate(data, activeGoals)
  }
}

function calculateCompletionRate(data: any[], goals: any[]) {
  if (goals.length === 0) return 0
  
  const goalIds = goals.map(goal => goal.id)
  const goalData = data.filter(item => goalIds.includes(item.goal_id))
  
  // Simple completion rate calculation
  return Math.min(100, Math.round((goalData.length / (goals.length * 30)) * 100))
}

function calculateComprehensiveSummary(data: any[], goals: any[]) {
  const dataTypes = [...new Set(data.map(item => item.data_type))]
  const activeGoals = goals.filter(goal => goal.status === 'active')
  const completedGoals = goals.filter(goal => goal.status === 'completed')
  
  // Calculate trends for each data type
  const trends = dataTypes.map(type => {
    const typeData = data.filter(item => item.data_type === type)
    return {
      type,
      count: typeData.length,
      trend: calculateSimpleTrend(typeData)
    }
  })

  return {
    totalGoals: goals.length,
    activeGoals: activeGoals.length,
    completedGoals: completedGoals.length,
    totalDataPoints: data.length,
    dataTypes: dataTypes.length,
    trends,
    averageEntriesPerDay: Math.round((data.length / 90) * 100) / 100
  }
}

function calculateSimpleTrend(data: any[]) {
  if (data.length < 2) return 'insufficient_data'
  
  const sortedData = data.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const firstHalf = sortedData.slice(0, Math.floor(sortedData.length / 2))
  const secondHalf = sortedData.slice(Math.floor(sortedData.length / 2))
  
  const firstAvg = firstHalf.reduce((sum, item) => sum + (item.value || 0), 0) / firstHalf.length
  const secondAvg = secondHalf.reduce((sum, item) => sum + (item.value || 0), 0) / secondHalf.length
  
  const change = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0
  
  return change > 5 ? 'increasing' : change < -5 ? 'decreasing' : 'stable'
}
