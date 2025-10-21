# DiscoverLocal.ai Backend API Documentation

## Base URL
- Development: `http://localhost:3001`

## Authentication
All protected endpoints require a Bearer token in the Authorization header:
```
Authorization: Bearer <token>
```

## Endpoints

### Health Check & Monitoring
- `GET /health` - Server health status with metrics
- `GET /metrics` - Performance metrics dashboard

### Authentication (`/api/auth`)
- `POST /api/auth/register` - Register new user
  - Body: `{ email, password, first_name, last_name, phone? }`
- `POST /api/auth/login` - Login user
  - Body: `{ email, password }`
- `POST /api/auth/logout` - Logout user (requires auth)
- `POST /api/auth/refresh` - Refresh token (requires auth)
- `GET /api/auth/me` - Get current user info (requires auth)

### Cities (`/api/cities`)
- `GET /api/cities` - Get all cities
- `GET /api/cities/:cityId` - Get specific city
- `GET /api/cities/:cityId/venues` - Get venues in a city
  - Query params: `category?, cuisine?, price?, limit?, offset?`
- `GET /api/cities/:cityId/lists` - Get lists for a city
  - Query params: `featured?, limit?, offset?`

### Venues (`/api/venues`)
- `GET /api/venues/:venueId` - Get venue details
- `GET /api/venues/:venueId/similar` - Get similar venues
  - Query params: `limit?`

### Lists (`/api/lists`)
- `GET /api/lists` - Get all public lists
  - Query params: `featured?, city?, limit?, offset?`
- `GET /api/lists/:listId` - Get list details with venues

### User (`/api/user`) - All require authentication
- `GET /api/user/lists` - Get user's lists
- `POST /api/user/lists` - Create new list
  - Body: `{ name, description?, is_public? }`
- `GET /api/user/lists/:listId` - Get user's list details
- `PUT /api/user/lists/:listId` - Update user's list
  - Body: `{ name?, description?, is_public?, venue_ids? }`
- `DELETE /api/user/lists/:listId` - Delete user's list
- `GET /api/user/favorites` - Get user's favorite venues
- `POST /api/user/favorites/:venueId` - Add venue to favorites
- `DELETE /api/user/favorites/:venueId` - Remove venue from favorites
- `GET /api/user/profile` - Get user profile
- `PUT /api/user/profile` - Update user profile
  - Body: `{ first_name?, last_name?, phone? }`
- `PUT /api/user/preferences` - Update user preferences
  - Body: `{ preferences }`

### Search (`/api/search`)
- `GET /api/search` - Search venues and lists
  - Query params: `q (required), city?, category?, cuisine?, price?, rating?, limit?, offset?`

### Recommendations (`/api/recommendations`)
- `GET /api/recommendations/personalized` - Get personalized recommendations (requires auth)
  - Query params: `cityId (required), limit?`
- `GET /api/recommendations/collaborative` - Get collaborative filtering recommendations (requires auth)
  - Query params: `cityId (required), limit?`
- `GET /api/recommendations/content` - Get content-based recommendations (requires auth)
  - Query params: `cityId (required), limit?`
- `GET /api/recommendations/hybrid` - Get hybrid recommendations (requires auth)
  - Query params: `cityId (required), limit?`
- `GET /api/recommendations/trending` - Get trending venues
  - Query params: `cityId (required), limit?`
- `POST /api/recommendations/cold-start` - Get recommendations for new users
  - Body: `{ cityId, preferences?, limit? }`
- `POST /api/recommendations/track` - Track user interaction (requires auth)
  - Body: `{ venueId, action, duration?, rating?, context? }`

## Response Format
All successful responses follow this structure:
```json
{
  "data_key": data_value
}
```

Error responses:
```json
{
  "error": "Error message"
}
```

## WebSocket Events

Connect to WebSocket at `ws://localhost:3001` with authentication token:
```javascript
const socket = io('ws://localhost:3001', {
  auth: { token: 'your-jwt-token' }
});
```

### Available Events:
- **venue:activity** - Real-time venue interactions
- **trending:update** - Trending venues updates
- **recommendations:update** - New personalized recommendations
- **user:typing** - Typing indicators for social features

## Status Codes
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 409: Conflict
- 500: Internal Server Error