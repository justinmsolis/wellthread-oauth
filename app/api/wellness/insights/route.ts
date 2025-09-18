import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// =============================================
// AI INSIGHTS ENDPOINTS
// =============================================

// GET /api/wellness/insights - Get AI insights
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const goalId = searchParams.get('goalId')
    const endpoint = searchParams.get('endpoint') || 'generate'
    const days = parseInt(searchParams.get('days') || '7')

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' }, 
        { status: 400 }
      )
    }

    // Route to different insights functions based on endpoint
    switch (endpoint) {
      case 'generate':
        return await generateInsights(userId, goalId, days)
      case 'recommendations':
        return await getRecommendations(userId, goalId, days)
      default:
        return await generateInsights(userId, goalId, days)
    }

  } catch (error) {
    console.error('Insights error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// POST /api/wellness/insights - Generate AI insights
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, goalId, days = 7 } = body

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' }, 
        { status: 400 }
      )
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - parseInt(days))

    // Get health data and goal information
    const [healthData, goal] = await Promise.all([
      getHealthData(userId, goalId, startDate),
      getGoal(userId, goalId)
    ])

    if (goalId && !goal) {
      return NextResponse.json(
        { error: 'Health goal not found' }, 
        { status: 404 }
      )
    }

    // Generate AI insights
    const insights = await generateAIInsights(healthData, goal, parseInt(days))

    return NextResponse.json({
      success: true,
      insights,
      dataPoints: healthData.length,
      period: `${days} days`
    })

  } catch (error) {
    console.error('Insights generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate insights' }, 
      { status: 500 }
    )
  }
}

async function generateInsights(userId: string, goalId: string | null, days: number) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  // Get health data and goal information
  const [healthData, goal] = await Promise.all([
    getHealthData(userId, goalId, startDate),
    getGoal(userId, goalId)
  ])

  if (goalId && !goal) {
    return NextResponse.json(
      { error: 'Health goal not found' }, 
      { status: 404 }
    )
  }

  // Generate AI insights
  const insights = await generateAIInsights(healthData, goal, days)

  return NextResponse.json({
    success: true,
    insights,
    dataPoints: healthData.length,
    period: `${days} days`
  })
}

async function getRecommendations(userId: string, goalId: string | null, days: number) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  // Get health data and goal information
  const [healthData, goal] = await Promise.all([
    getHealthData(userId, goalId, startDate),
    getGoal(userId, goalId)
  ])

  // Generate personalized recommendations
  const recommendations = await generateRecommendations(healthData, goal, days)

  return NextResponse.json({
    success: true,
    recommendations,
    dataPoints: healthData.length,
    period: `${days} days`
  })
}

async function getHealthData(userId: string, goalId: string | null, startDate: Date) {
  let query = supabase
    .from('health_data')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: false })

  if (goalId) {
    query = query.eq('goal_id', goalId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching health data:', error)
    return []
  }

  return data || []
}

async function getGoal(userId: string, goalId: string | null) {
  if (!goalId) return null

  const { data, error } = await supabase
    .from('health_goals')
    .select('*')
    .eq('id', goalId)
    .eq('user_id', userId)
    .single()

  if (error) {
    console.error('Error fetching goal:', error)
    return null
  }

  return data
}

async function generateAIInsights(healthData: any[], goal: any, days: number) {
  try {
    // Prepare data summary for AI
    const dataSummary = prepareDataSummary(healthData, goal)
    
    const prompt = `Based on the following health data from the last ${days} days, provide personalized insights and recommendations:

Health Data Summary:
${JSON.stringify(dataSummary, null, 2)}

Goal: ${goal ? goal.title : 'General wellness'}

Please provide:
1. Key patterns and trends observed
2. Areas of improvement
3. Positive progress indicators
4. Specific actionable recommendations
5. Potential correlations between different health metrics

Format the response as a structured JSON object with sections for patterns, improvements, progress, and recommendations.`

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a health and wellness AI assistant. Provide personalized, actionable insights based on health data. Always respond with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.7
    })

    const response = completion.choices[0]?.message?.content || '{}'
    return JSON.parse(response)

  } catch (error) {
    console.error('OpenAI API error:', error)
    
    // Fallback insights if AI fails
    return {
      patterns: ["Data collection is active", "Regular monitoring in progress"],
      improvements: ["Continue consistent data logging", "Consider adding more data types"],
      progress: ["Successfully tracking health metrics", "Building health data history"],
      recommendations: [
        "Maintain current data collection routine",
        "Consider setting specific health goals",
        "Review data weekly for patterns"
      ]
    }
  }
}

async function generateRecommendations(healthData: any[], goal: any, days: number) {
  try {
    const dataSummary = prepareDataSummary(healthData, goal)
    
    const prompt = `Based on this health data, provide 3-5 specific, actionable recommendations:

${JSON.stringify(dataSummary, null, 2)}

Goal: ${goal ? goal.title : 'General wellness'}

Provide recommendations that are:
- Specific and actionable
- Based on the actual data patterns
- Realistic and achievable
- Focused on the user's goal

Format as a JSON array of recommendation objects with title, description, and priority.`

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a health coach AI. Provide specific, actionable recommendations based on health data. Always respond with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 800,
      temperature: 0.7
    })

    const response = completion.choices[0]?.message?.content || '[]'
    return JSON.parse(response)

  } catch (error) {
    console.error('OpenAI API error:', error)
    
    // Fallback recommendations
    return [
      {
        title: "Continue Data Collection",
        description: "Keep logging your health data consistently to build better insights",
        priority: "high"
      },
      {
        title: "Set Specific Goals",
        description: "Define clear, measurable health goals to track progress",
        priority: "medium"
      },
      {
        title: "Review Weekly Patterns",
        description: "Check your data weekly to identify trends and make adjustments",
        priority: "medium"
      }
    ]
  }
}

function prepareDataSummary(healthData: any[], goal: any) {
  const dataTypes = [...new Set(healthData.map(item => item.data_type))]
  const summary: any = {
    totalEntries: healthData.length,
    dataTypes: dataTypes.length,
    dateRange: {
      start: healthData.length > 0 ? healthData[healthData.length - 1].created_at : null,
      end: healthData.length > 0 ? healthData[0].created_at : null
    }
  }

  // Add summary for each data type
  dataTypes.forEach(type => {
    const typeData = healthData.filter(item => item.data_type === type)
    const values = typeData.map(item => item.value).filter(val => val !== null && val !== undefined)
    
    summary[type] = {
      count: typeData.length,
      average: values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0,
      latest: typeData.length > 0 ? typeData[0].value : null
    }
  })

  return summary
}
