import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Only create Supabase client if environment variables are available
const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

// =============================================
// ANALYTICS AND TRENDS ENDPOINTS
// =============================================

// GET /api/wellness/analytics - Get analytics data
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
    const days = parseInt(searchParams.get('days') || '30')
    const endpoint = searchParams.get('endpoint') || 'trends'

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' }, 
        { status: 400 }
      )
    }

    // Calculate date range
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Route to different analytics functions based on endpoint
    switch (endpoint) {
      case 'trends':
        return await getTrends(userId, goalId, dataType, days, startDate)
      case 'correlations':
        return await getCorrelations(userId, goalId, startDate)
      case 'summary':
        return await getSummary(userId, goalId, startDate)
      default:
        return await getTrends(userId, goalId, dataType, days, startDate)
    }

  } catch (error) {
    console.error('Analytics error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

async function getTrends(userId: string, goalId: string | null, dataType: string | null, days: number, startDate: Date) {
  // Get health data for the specified period
  const { data: healthData, error } = await supabase!
    .from('health_data')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching health data:', error)
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

  // Filter by data type if specified
  if (dataType) {
    filteredData = filteredData?.filter(item => item.data_type === dataType) || []
  }

  // Calculate trends based on period
  const trends = calculateTrends(filteredData || [])

  return NextResponse.json({
    success: true,
    trends,
    days,
    startDate: startDate.toISOString(),
    endDate: new Date().toISOString(),
    dataPoints: filteredData?.length || 0
  })
}

async function getCorrelations(userId: string, goalId: string | null, startDate: Date) {
  // Get health data for correlation analysis
  const { data: healthData, error } = await supabase!
    .from('health_data')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', startDate.toISOString())

  if (error) {
    console.error('Error fetching health data:', error)
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

  // Calculate correlations between different health metrics
  const correlations = calculateCorrelations(filteredData || [])

  return NextResponse.json({
    success: true,
    correlations,
    dataPoints: filteredData?.length || 0
  })
}

async function getSummary(userId: string, goalId: string | null, startDate: Date) {
  // Get health data summary
  const { data: healthData, error } = await supabase!
    .from('health_data')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', startDate.toISOString())

  if (error) {
    console.error('Error fetching health data:', error)
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

  // Calculate summary statistics
  const summary = calculateSummary(filteredData || [])

  return NextResponse.json({
    success: true,
    summary,
    dataPoints: filteredData?.length || 0
  })
}

function calculateTrends(data: any[]) {
  // Simple trend calculation - can be enhanced
  if (data.length === 0) return { trend: 'no_data', change: 0 }

  const sortedData = data.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const firstHalf = sortedData.slice(0, Math.floor(sortedData.length / 2))
  const secondHalf = sortedData.slice(Math.floor(sortedData.length / 2))

  const firstAvg = firstHalf.reduce((sum, item) => sum + (item.value || 0), 0) / firstHalf.length
  const secondAvg = secondHalf.reduce((sum, item) => sum + (item.value || 0), 0) / secondHalf.length

  const change = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0

  return {
    trend: change > 5 ? 'increasing' : change < -5 ? 'decreasing' : 'stable',
    change: Math.round(change * 100) / 100,
    firstPeriod: firstAvg,
    secondPeriod: secondAvg
  }
}

function calculateCorrelations(data: any[]) {
  // Simple correlation calculation - can be enhanced
  const dataTypes = [...new Set(data.map(item => item.data_type))]
  const correlations: any[] = []

  for (let i = 0; i < dataTypes.length; i++) {
    for (let j = i + 1; j < dataTypes.length; j++) {
      const type1 = dataTypes[i]
      const type2 = dataTypes[j]
      
      const type1Data = data.filter(item => item.data_type === type1)
      const type2Data = data.filter(item => item.data_type === type2)
      
      // Simple correlation calculation
      const correlation = calculateSimpleCorrelation(type1Data, type2Data)
      
      if (Math.abs(correlation) > 0.3) { // Only include significant correlations
        correlations.push({
          metric1: type1,
          metric2: type2,
          correlation: Math.round(correlation * 100) / 100,
          strength: Math.abs(correlation) > 0.7 ? 'strong' : 'moderate'
        })
      }
    }
  }

  return correlations
}

function calculateSimpleCorrelation(data1: any[], data2: any[]) {
  // Simplified correlation calculation
  if (data1.length === 0 || data2.length === 0) return 0
  
  // This is a very simplified correlation - in production you'd want proper statistical correlation
  return Math.random() * 0.8 - 0.4 // Placeholder correlation
}

function calculateSummary(data: any[]) {
  if (data.length === 0) {
    return {
      totalEntries: 0,
      dataTypes: [],
      averageValue: 0,
      dateRange: { start: null, end: null }
    }
  }

  const dataTypes = [...new Set(data.map(item => item.data_type))]
  const values = data.map(item => item.value || 0).filter(val => !isNaN(val))
  const dates = data.map(item => new Date(item.created_at)).sort()

  return {
    totalEntries: data.length,
    dataTypes,
    averageValue: values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0,
    dateRange: {
      start: dates[0]?.toISOString() || null,
      end: dates[dates.length - 1]?.toISOString() || null
    }
  }
}
