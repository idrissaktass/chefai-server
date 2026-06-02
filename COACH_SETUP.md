# AI Coach Setup Guide 🤖

## Overview
The AI Coach feature allows users to have real-time conversations with an AI dietitian. The AI understands the user's daily nutrition data and provides personalized, data-driven advice.

## Architecture

### Frontend (React Native - Expo)
- **Location**: `frontend/app/components/CoachScreen.tsx`
- **Service**: `frontend/services/openai.ts`
- Displays a professional chat interface with:
  - Real-time nutrition dashboard (calories, macros)
  - Daily insights based on nutrition data
  - Chat messages with timestamp
  - AI dietitian avatar

### Backend (Node.js/Express)
- **Location**: `routes/openai.js`
- **Endpoint**: `POST /api/openai/coach`
- Handles:
  - OpenAI API calls with system prompts
  - User authentication (JWT)
  - Context-aware responses based on nutrition data

## Setup Instructions

### 1. Environment Variables
Create a `.env` file in the root directory (or copy from `.env.example`):

```bash
# Required for Coach AI
OPENAI_API_KEY=sk-your-actual-key-here
OPENAI_MODEL=gpt-4o-mini
```

Get your OpenAI API key from: https://platform.openai.com/api-keys

### 2. Backend Configuration
The coach endpoint is already set up in `routes/openai.js`. It:
- Verifies user JWT token
- Builds a professional dietitian system prompt
- Includes user's daily nutrition context
- Sends the message to OpenAI
- Returns the response to the frontend

### 3. Frontend Configuration
The frontend automatically:
- Collects daily nutrition totals from meal logs
- Builds macro targets
- Retrieves weight progress and streak data
- Sends everything to the backend with each message

### 4. API Request Flow

```
Frontend (CoachScreen.tsx)
    ↓
    sendCoachMessage(message, context)
    ↓
    POST /api/openai/coach
    ↓
    Backend (openai.js)
    ↓
    buildSystemPrompt(context)
    ↓
    OpenAI API (gpt-4o-mini)
    ↓
    Backend returns response
    ↓
    Frontend displays in chat
```

## System Prompt Features

The AI Coach is designed to:

✅ **Be Professional & Empathetic**
- Acts as a registered dietitian
- Never shames or judges users
- Celebrates progress and consistency

✅ **Provide Data-Driven Advice**
- Analyzes current calorie/macro intake
- Compares against user targets
- Suggests specific food recommendations

✅ **Respond Contextually**
- Knows user's weight progress
- Understands daily meal history
- Recognizes consistency streak

✅ **Give Actionable Suggestions**
- Short, concise responses (2-3 sentences)
- Specific meal recommendations
- Encouragement and motivation

## Example Conversations

### Scenario 1: High Calorie Intake
**User**: "I'm worried about my calories today"
**AI**: "You've consumed 2,150 kcal so far, which is about 110% of your 2,000 kcal target. For the rest of the day, focus on low-calorie, high-volume foods like vegetables, lean proteins, and plenty of water. You're still on track overall! 💪"

### Scenario 2: Low Protein
**User**: "Should I eat something before bed?"
**AI**: "Great thinking! You're at 95g of protein, but your target is 150g. A protein-rich snack like Greek yogurt (20g protein), cottage cheese, or a protein shake would be perfect. This will help your muscles recover and keep you satisfied! 🏋️"

### Scenario 3: Goal Progress
**User**: "How's my progress?"
**AI**: "You're crushing it with a 🔥 12-day streak! You've lost 2 kg so far and only have 3 kg to go until your goal. Keep up this consistency—you're building amazing habits! 🎉"

## Testing Locally

1. **Start Backend**:
```bash
cd /path/to/ai-recipe
npm start  # or node server.js
```

2. **Frontend Development**:
```bash
cd frontend
npm run start  # Expo start
```

3. **Test Coach Endpoint**:
```bash
curl -X POST http://localhost:8080/api/openai/coach \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "message": "Should I eat more protein?",
    "context": {
      "todaysTotals": { "calories": 1800, "protein": 100, "carbs": 200, "fat": 60 },
      "targets": { "calories": 2000, "protein": 150, "carbs": 250, "fat": 70 },
      "recentMeals": { "breakfast": "Eggs and toast", "lunch": "Chicken salad" },
      "weightProgress": { "currentWeight": 75, "goalWeight": 70 },
      "streakDays": 5
    }
  }'
```

## Troubleshooting

### ❌ "OpenAI coach is unavailable"
- Check OPENAI_API_KEY is set in .env
- Verify API key is valid on https://platform.openai.com
- Check backend logs for error details

### ❌ "Invalid token"
- Ensure user is logged in
- Verify JWT token is fresh
- Check JWT_SECRET matches between frontend and backend

### ❌ No response from coach
- Check internet connection
- Verify API endpoint is accessible
- Check OpenAI API quota/billing

### ❌ Slow responses
- OpenAI API calls can take 2-5 seconds
- Consider implementing loading states
- Check network connectivity

## Performance Optimization

### Frontend
- ✅ Show loading indicator while waiting for response
- ✅ Add visual feedback on send
- ✅ Limit message history to last 30 messages
- ✅ Debounce rapid consecutive messages

### Backend
- ✅ Cache user's daily totals
- ✅ Rate limit coach endpoint (5 calls/min per user)
- ✅ Log all coach interactions for debugging

## Future Enhancements

- 💡 Add conversation history persistence
- 💡 Custom macro targets per user
- 💡 Meal suggestions from user's favorite foods
- 💡 Weekly performance summaries
- 💡 Integration with fitness tracking
- 💡 Voice input/output for coach

## Security Notes

- ✅ All requests require valid JWT token
- ✅ User context is only sent for authenticated requests
- ✅ Sensitive data (API keys) never exposed to frontend
- ✅ Rate limiting prevents API abuse

---

**Last Updated**: June 2, 2026
**Status**: ✅ Production Ready
