export interface User {
    id: string;
    email: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
    password_hash?: string;
    preferences: Record<string, any>;
    is_premium: boolean;
    created_at: Date;
    updated_at: Date;
}
export interface City {
    id: string;
    name: string;
    state?: string;
    country: string;
    description?: string;
    image_url?: string;
    timezone?: string;
    coordinates: {
        lat: number;
        lng: number;
    };
}
export interface Venue {
    id: string;
    name: string;
    city_id: string;
    category: string;
    cuisine?: string;
    price_range?: string;
    description?: string;
    address?: string;
    phone?: string;
    website?: string;
    image_url?: string;
    rating?: number;
    coordinates: {
        lat: number;
        lng: number;
    };
    hours?: Record<string, string>;
    features?: string[];
    created_at: Date;
    updated_at: Date;
}
export interface List {
    id: string;
    name: string;
    city_id: string;
    category?: string;
    description?: string;
    curator?: string;
    is_featured: boolean;
    venue_ids: string[];
    image_url?: string;
    created_at: Date;
    updated_at: Date;
}
export interface UserList {
    id: string;
    user_id: string;
    name: string;
    description?: string;
    venue_ids: string[];
    is_public: boolean;
    created_at: Date;
    updated_at: Date;
}
export interface Session {
    id: string;
    user_id: string;
    token: string;
    expires_at: Date;
    created_at: Date;
}
export interface ApiResponse<T> {
    data?: T;
    error?: string;
    message?: string;
    pagination?: {
        limit: number;
        offset: number;
        total?: number;
    };
}
export interface JWTPayload {
    userId: string;
    email: string;
    isPremium?: boolean;
}
export interface SearchParams {
    q: string;
    city?: string;
    category?: string;
    cuisine?: string;
    price?: string;
    rating?: number;
    limit?: number;
    offset?: number;
}
//# sourceMappingURL=index.d.ts.map