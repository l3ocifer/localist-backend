# Shared Types Documentation

## API Contract Between Frontend and Backend

This document defines the shared type definitions between the frontend and backend applications.

### User Type
```typescript
export interface User {
  id: string
  email: string
  phone?: string
  first_name: string
  last_name: string
  preferences: Record<string, any>
  is_premium: boolean
  created_at: string  // ISO 8601 datetime
  updated_at: string  // ISO 8601 datetime
}
```

### City Type
```typescript
export interface City {
  id: string
  name: string
  state?: string
  country: string
  description?: string
  image_url?: string
  timezone?: string
  coordinates: {
    lat: number
    lng: number
  }
}
```

### Venue Type
```typescript
export interface Venue {
  id: string
  name: string
  city_id: string
  category: string
  cuisine?: string
  price_range: string  // "$", "$$", "$$$", "$$$$"
  description?: string
  address?: string
  phone?: string
  website?: string
  image_url?: string
  rating?: number
  coordinates: {
    lat: number
    lng: number
  }
  hours?: Record<string, string>
  features?: string[]
  created_at: string
  updated_at: string
}
```

### List Type
```typescript
export interface List {
  id: string
  name: string
  city_id: string
  category?: string
  description?: string
  curator: string
  is_featured: boolean
  venue_ids: string[]
  venues?: Venue[]  // Populated when requested
  image_url?: string
  created_at: string
  updated_at: string
}
```

### UserList Type
```typescript
export interface UserList {
  id: string
  user_id: string
  name: string
  description?: string
  venue_ids: string[]
  venues?: Venue[]  // Populated when requested
  is_public: boolean
  created_at: string
  updated_at: string
}
```

### Auth Types
```typescript
export interface LoginData {
  email: string
  password: string
}

export interface RegisterData {
  email: string
  password: string
  first_name: string
  last_name: string
  phone?: string
}

export interface AuthResponse {
  user: User
  token: string
  refresh_token: string
}
```

### Search Types
```typescript
export interface SearchParams {
  q?: string
  city?: string
  category?: string
  cuisine?: string
  price?: string
  page?: number
  limit?: number
}

export interface SearchResults {
  venues: Venue[]
  total: number
  page: number
  pages: number
}
```

### API Response Types
```typescript
export interface ApiResponse<T> {
  data?: T
  error?: string
  message?: string
  pagination?: {
    limit: number
    offset: number
    total?: number
  }
}
```

## API Versioning

- **Current Version:** v1
- **Base URL:** `/api` (handled by ingress)
- **Content-Type:** `application/json`
- **Authentication:** Bearer token in Authorization header

## Breaking Changes Policy

1. All breaking changes require major version bump
2. 6-month deprecation notice before removal of old version
3. Both teams must approve breaking changes
4. Migration guides required for breaking changes

