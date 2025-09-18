import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// =============================================
// ANALYTICS AND TRENDS ENDPOINTS
// =============================================

// GET /api/wellness/analytics/trends - Get trend analysis
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const goalId = searchParams.get('goalId')
    const dataType = searchParams.get('dataType')
    const period = searchParams.get('period') || 'month'
    const days = parseInt(searchParams.get('days') || '30')

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' }, 
        { status: 400 }
      )
    }

    // Calculate date range
    let startDate = new Date()
    if (days) {
      startDate.setDate(startDate.getDate() - days)
    } else {
      switch (period) {
        case 'week':
          startDate.setDate(startDate.getDate() - 7)
          break
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1)
          break
        case 'quarter':
          startDate.setMonth(startDate.getMonth() - 3)
          break
        case 'year':
          startDate.setFullYear(startDate.getFullYear() - 1)
          break
      }
    }

    // Build query
    let query = supabase
      .from('health_data')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate.toISOString())

    if (goalId) query = query.eq('goal_id', goalId)
    if (dataType) query = query.eq('data_type', dataType)

    query = query.order('date', { ascending: true })

    const { data: healthData, error } = await query

    if (error) {
      console.error('Error fetching trend data:', error)
      return NextResponse.json(
        { error: 'Failed to fetch trend data' }, 
        { status: 500 }
      )
    }

    // Process data into trends
    const trends = processTrendData(healthData || [])

    return NextResponse.json({
      success: true,
      trends,
      period,
      startDate: startDate.toISOString(),
      endDate: new Date().toISOString(),
      dataPoints: healthData?.length || 0
    })

  } catch (error) {
    console.error('Analytics trends error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// GET /api/wellness/analytics/correlations - Find correlations between health metrics
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const goalId = searchParams.get('goalId')
    const days = parseInt(searchParams.get('days') || '30')

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' }, 
        { status: 400 }
      )
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Get health data for correlation analysis
    let query = supabase
      .from('health_data')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate.toISOString())
      .order('date', { ascending: true })

    if (goalId) query = query.eq('goal_id', goalId)

    const { data: healthData, error } = await query

    if (error) {
      console.error('Error fetching correlation data:', error)
      return NextResponse.json(
        { error: 'Failed to fetch correlation data' }, 
        { status: 500 }
      )
    }

    // Group data by date for correlation analysis
    const dailyData = groupDataByDate(healthData || [])
    
    // Calculate correlations
    const correlations = calculateCorrelations(dailyData)

    return NextResponse.json({
      success: true,
      correlations,
      period: `${days} days`,
      dataPoints: Object.keys(dailyData).length
    })

  } catch (error) {
    console.error('Analytics correlations error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// GET /api/wellness/analytics/progress - Get progress tracking for goals
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const goalId = searchParams.get('goalId')

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' }, 
        { status: 400 }
      )
    }

    // Get goals
    let goalsQuery = supabase
      .from('health_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')

    if (goalId) goalsQuery = goalsQuery.eq('id', goalId)

    const { data: goals, error: goalsError } = await goalsQuery

    if (goalsError) {
      console.error('Error fetching goals:', goalsError)
      return NextResponse.json(
        { error: 'Failed to fetch goals' }, 
        { status: 500 }
      )
    }

    // Calculate progress for each goal
    const progressData = await Promise.all(
      (goals || []).map(async (goal) => {
        // Get data for this goal
        const { data: healthData, error: dataError } = await supabase
          .from('health_data')
          .select('*')
          .eq('user_id', userId)
          .eq('goal_id', goal.id)
          .gte('date', goal.start_date)
          .order('date', { ascending: true })

        if (dataError) {
          console.error('Error fetching goal data:', dataError)
          return null
        }

        // Calculate progress metrics
        const progress = calculateGoalProgress(goal, healthData || [])
        
        return {
          goalId: goal.id,
          title: goal.title,
          targetValue: goal.target_value,
          targetUnit: goal.target_unit,
          timeFrame: goal.time_frame,
          startDate: goal.start_date,
          endDate: goal.end_date,
          progress,
          dataPoints: healthData?.length || 0,
          lastUpdate: healthData && healthData.length > 0 ? healthData[healthData.length - 1].date : null
        }
      })
    )

    return NextResponse.json({
      success: true,
      progress: progressData.filter(p => p !== null)
    })

  } catch (error) {
    console.error('Analytics progress error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// =============================================
// HELPER FUNCTIONS
// =============================================

function processTrendData(healthData: any[]) {
  const trends: any = {}
  
  // Group data by type and date
  healthData.forEach(entry => {
    const dateKey = entry.date.split('T')[0]
    
    if (!trends[entry.data_type]) {
      trends[entry.data_type] = {}
    }
    
    if (!trends[entry.data_type][dateKey]) {
      trends[entry.data_type][dateKey] = []
    }
    
    trends[entry.data_type][dateKey].push(entry)
  })

  // Convert to array format for frontend
  const processedTrends: any = {}
  Object.entries(trends).forEach(([type, dailyData]: [string, any]) => {
    processedTrends[type] = Object.entries(dailyData).map(([date, entries]: [string, any]) => ({
      date,
      count: entries.length,
      avgValue: calculateAverageValue(entries),
      data: entries
    }))
  })

  return processedTrends
}

function groupDataByDate(healthData: any[]) {
  const dailyData: any = {}
  
  healthData.forEach(entry => {
    const dateKey = entry.date.split('T')[0]
    if (!dailyData[dateKey]) {
      dailyData[dateKey] = {}
    }
    dailyData[dateKey][entry.data_type] = entry.data
  })

  return dailyData
}

function calculateCorrelations(dailyData: any) {
  const correlations: any[] = []
  const dataTypes = Object.keys(dailyData[Object.keys(dailyData)[0]] || {})
  
  for (let i = 0; i < dataTypes.length; i++) {
    for (let j = i + 1; j < dataTypes.length; j++) {
      const type1 = dataTypes[i]
      const type2 = dataTypes[j]
      
      const values1: number[] = []
      const values2: number[] = []
      
      Object.values(dailyData).forEach((day: any) => {
        if (day[type1] && day[type2]) {
          const val1 = extractNumericValue(day[type1])
          const val2 = extractNumericValue(day[type2])
          if (val1 !== null && val2 !== null) {
            values1.push(val1)
            values2.push(val2)
          }
        }
      })
      
      if (values1.length > 3) {
        const correlation = calculatePearsonCorrelation(values1, values2)
        if (Math.abs(correlation) > 0.3) { // Only show significant correlations
          correlations.push({
            type1,
            type2,
            correlation: Math.round(correlation * 100) / 100,
            strength: Math.abs(correlation) > 0.7 ? 'strong' : 'moderate',
            direction: correlation > 0 ? 'positive' : 'negative',
            dataPoints: values1.length
          })
        }
      }
    }
  }
  
  return correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
}

function calculateAverageValue(entries: any[]) {
  if (!entries || entries.length === 0) return 0
  
  const values = entries.map(entry => {
    const data = entry.data || entry[`${entry.data_type}_data`]
    return extractNumericValue(data)
  }).filter(val => val !== null)
  
  if (values.length === 0) return 0
  return values.reduce((sum, val) => sum + val, 0) / values.length
}

function extractNumericValue(data: any): number | null {
  if (typeof data === 'number') return data
  if (typeof data === 'object' && data !== null) {
    // Try common numeric fields
    const numericFields = ['value', 'level', 'duration', 'quality', 'severity', 'systolic', 'diastolic']
    for (const field of numericFields) {
      if (data[field] && typeof data[field] === 'number') {
        return data[field]
      }
    }
  }
  return null
}

function calculatePearsonCorrelation(x: number[], y: number[]) {
  const n = x.length
  const sumX = x.reduce((a, b) => a + b, 0)
  const sumY = y.reduce((a, b) => a + b, 0)
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0)
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0)
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0)
  
  const numerator = n * sumXY - sumX * sumY
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))
  
  return denominator === 0 ? 0 : numerator / denominator
}

function calculateGoalProgress(goal: any, healthData: any[]) {
  const totalDays = Math.ceil((new Date().getTime() - new Date(goal.start_date).getTime()) / (1000 * 60 * 60 * 24))
  const dataDays = new Set(healthData.map(d => d.date.split('T')[0])).size
  
  return {
    completionPercentage: Math.min((dataDays / totalDays) * 100, 100),
    dataConsistency: (dataDays / totalDays) * 100,
    totalEntries: healthData.length,
    averageEntriesPerDay: healthData.length / Math.max(totalDays, 1)
  }
}