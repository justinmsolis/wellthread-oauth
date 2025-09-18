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

// POST /api/wellness/insights/generate - Generate AI insights
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
      period: `${days} days`,
      dataPoints: healthData.length,
      goal: goal ? {
        title: goal.title,
        category: goal.category,
        targetValue: goal.target_value
      } : null
    })

  } catch (error) {
    console.error('Generate insights error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// GET /api/wellness/insights/daily - Get daily AI insights
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

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Get today's data
    const todayData = await getHealthData(userId, null, today, tomorrow)

    // Get active goals
    const { data: activeGoals, error: goalsError } = await supabase
      .from('health_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')

    if (goalsError) {
      console.error('Error fetching active goals:', goalsError)
      return NextResponse.json(
        { error: 'Failed to fetch goals' }, 
        { status: 500 }
      )
    }

    // Generate daily summary
    const dailyInsights = generateDailyInsights(todayData, activeGoals || [])

    return NextResponse.json({
      success: true,
      insights: dailyInsights,
      date: today.toISOString().split('T')[0],
      dataPoints: todayData.length,
      activeGoals: activeGoals?.length || 0
    })

  } catch (error) {
    console.error('Get daily insights error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// GET /api/wellness/insights/recommendations - Get personalized recommendations
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const goalId = searchParams.get('goalId')
    const limit = parseInt(searchParams.get('limit') || '5')

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' }, 
        { status: 400 }
      )
    }

    // Get recent health data (last 14 days)
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 14)

    const [healthData, goal] = await Promise.all([
      getHealthData(userId, goalId, startDate),
      getGoal(userId, goalId)
    ])

    // Generate recommendations
    const recommendations = await generateRecommendations(healthData, goal, limit)

    return NextResponse.json({
      success: true,
      recommendations,
      basedOn: `${healthData.length} data points from last 14 days`,
      goal: goal ? {
        title: goal.title,
        category: goal.category
      } : null
    })

  } catch (error) {
    console.error('Get recommendations error:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// =============================================
// HELPER FUNCTIONS
// =============================================

async function getHealthData(userId: string, goalId: string | null, startDate: Date, endDate?: Date) {
  let query = supabase
    .from('health_data')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate.toISOString())

  if (endDate) {
    query = query.lt('date', endDate.toISOString())
  }

  if (goalId) {
    query = query.eq('goal_id', goalId)
  }

  query = query.order('date', { ascending: false })

  const { data, error } = await query

  if (error) {
    console.error('Error fetching health data:', error)
    return []
  }

  return data || []
}

async function getGoal(userId: string, goalId: string | null) {
  if (goalId) {
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
  } else {
    const { data, error } = await supabase
      .from('health_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error) {
      console.error('Error fetching active goal:', error)
      return null
    }

    return data
  }
}

async function generateAIInsights(healthData: any[], goal: any, days: number) {
  try {
    // Prepare data summary for AI
    const dataSummary = prepareDataSummary(healthData, days)
    
    const prompt = `
You are a health and wellness AI assistant. Analyze the following health tracking data and provide personalized insights.

Goal: ${goal?.title || 'General Health Tracking'}
Category: ${goal?.category || 'General'}
Target: ${goal?.target_value || 'N/A'} ${goal?.target_unit || ''}
Time Period: Last ${days} days

Health Data Summary:
${dataSummary}

Please provide:
1. Key insights about patterns and trends
2. Areas of strength and improvement
3. Specific actionable recommendations
4. Health correlations you notice
5. Progress toward the stated goal

Format your response as a JSON object with the following structure:
{
  "summary": "Brief overall assessment",
  "insights": [
    {
      "type": "pattern|trend|correlation|achievement",
      "title": "Insight title",
      "description": "Detailed description",
      "priority": "high|medium|low",
      "category": "sleep|stress|nutrition|exercise|general"
    }
  ],
  "recommendations": [
    {
      "title": "Recommendation title",
      "description": "What to do",
      "reason": "Why this helps",
      "priority": "high|medium|low",
      "category": "sleep|stress|nutrition|exercise|general"
    }
  ],
  "progress": {
    "overall": "excellent|good|fair|needs_improvement",
    "description": "Progress description",
    "percentage": 0-100
  }
}

Be specific, actionable, and encouraging. Focus on evidence-based health recommendations.
`

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a knowledgeable health and wellness AI assistant with expertise in analyzing health tracking data and providing personalized insights and recommendations."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })

    const response = completion.choices[0].message.content
    
    // Try to parse JSON response
    try {
      return JSON.parse(response || '{}')
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError)
      return {
        summary: "AI analysis completed",
        insights: [{
          type: "general",
          title: "Data Analysis",
          description: response,
          priority: "medium",
          category: "general"
        }],
        recommendations: [],
        progress: {
          overall: "good",
          description: "Continue tracking your health data",
          percentage: 75
        }
      }
    }

  } catch (error) {
    console.error('AI insights generation error:', error)
    return {
      summary: "Unable to generate AI insights at this time",
      insights: [{
        type: "general",
        title: "Keep Tracking",
        description: "Continue logging your health data to receive personalized insights.",
        priority: "medium",
        category: "general"
      }],
      recommendations: [{
        title: "Consistent Tracking",
        description: "Log your health data daily for better insights",
        reason: "More data leads to better personalized recommendations",
        priority: "high",
        category: "general"
      }],
      progress: {
        overall: "good",
        description: "Continue your health journey",
        percentage: 50
      }
    }
  }
}

async function generateRecommendations(healthData: any[], goal: any, limit: number) {
  try {
    const dataSummary = prepareDataSummary(healthData, 14)
    
    const prompt = `
Based on this health tracking data from the last 14 days, provide ${limit} specific, actionable recommendations.

Goal: ${goal?.title || 'General Health'}
Data: ${dataSummary}

Provide recommendations as a JSON array:
[
  {
    "title": "Recommendation title",
    "description": "What to do",
    "reason": "Why this helps",
    "priority": "high|medium|low",
    "category": "sleep|stress|nutrition|exercise|general",
    "actionable": "Specific steps to take"
  }
]

Focus on evidence-based, practical recommendations that can be implemented immediately.
`

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a health expert providing personalized, actionable recommendations based on health tracking data."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1500
    })

    const response = completion.choices[0].message.content
    
    try {
      return JSON.parse(response || '[]')
    } catch (parseError) {
      console.error('Failed to parse recommendations as JSON:', parseError)
      return [{
        title: "Continue Tracking",
        description: "Keep logging your health data consistently",
        reason: "Consistent tracking leads to better insights",
        priority: "high",
        category: "general",
        actionable: "Set a daily reminder to log your health data"
      }]
    }

  } catch (error) {
    console.error('AI recommendations generation error:', error)
    return [{
      title: "Maintain Consistency",
      description: "Continue your current tracking habits",
      reason: "Consistent data collection is key to health insights",
      priority: "medium",
      category: "general",
      actionable: "Keep logging your health data daily"
    }]
  }
}

function generateDailyInsights(todayData: any[], activeGoals: any[]) {
  const insights: any[] = []
  
  // Check data completeness
  const dataTypes = new Set(todayData.map(d => d.data_type))
  const expectedTypes = ['sleep', 'stress', 'nutrition', 'exercise']
  const missingTypes = expectedTypes.filter(type => !dataTypes.has(type))
  
  if (missingTypes.length > 0) {
    insights.push({
      type: "reminder",
      title: "Complete Your Daily Tracking",
      description: `Consider logging: ${missingTypes.join(', ')}`,
      priority: "medium",
      category: "general"
    })
  }
  
  // Analyze today's data
  todayData.forEach(entry => {
    const insight = analyzeDataEntry(entry)
    if (insight) {
      insights.push(insight)
    }
  })
  
  // Add goal-specific insights
  if (activeGoals.length > 0) {
    insights.push({
      type: "motivation",
      title: "Stay Focused on Your Goals",
      description: `You have ${activeGoals.length} active health goal${activeGoals.length > 1 ? 's' : ''}. Keep tracking to achieve them!`,
      priority: "low",
      category: "general"
    })
  }
  
  return insights
}

function prepareDataSummary(healthData: any[], days: number) {
  const dataByType: any = {}
  
  healthData.forEach(entry => {
    if (!dataByType[entry.data_type]) {
      dataByType[entry.data_type] = []
    }
    dataByType[entry.data_type].push(entry)
  })
  
  let summary = `Data from last ${days} days:\n`
  
  Object.entries(dataByType).forEach(([type, data]: [string, any]) => {
    summary += `\n${type.toUpperCase()} (${data.length} entries):\n`
    data.slice(0, 5).forEach((entry: any) => {
      summary += `- ${entry.date.split('T')[0]}: ${JSON.stringify(entry.data)}\n`
    })
  })
  
  return summary
}

function analyzeDataEntry(entry: any) {
  // This is a simplified analysis - in a real implementation, this would be more sophisticated
  switch (entry.data_type) {
    case 'sleep':
      const sleepData = entry.sleep_data || entry.data
      if (sleepData?.duration && sleepData.duration < 6) {
        return {
          type: "concern",
          title: "Sleep Duration Alert",
          description: `You logged ${sleepData.duration} hours of sleep. Consider aiming for 7-9 hours.`,
          priority: "high",
          category: "sleep"
        }
      }
      break
      
    case 'stress':
      const stressData = entry.stress_data || entry.data
      if (stressData?.level && stressData.level > 7) {
        return {
          type: "concern",
          title: "High Stress Level",
          description: `Your stress level is ${stressData.level}/10. Consider stress management techniques.`,
          priority: "high",
          category: "stress"
        }
      }
      break
      
    case 'exercise':
      const exerciseData = entry.exercise_data || entry.data
      if (exerciseData?.duration && exerciseData.duration > 30) {
        return {
          type: "achievement",
          title: "Great Exercise Session",
          description: `Excellent ${exerciseData.duration} minutes of ${exerciseData.type || 'exercise'}!`,
          priority: "low",
          category: "exercise"
        }
      }
      break
  }
  
  return null
}