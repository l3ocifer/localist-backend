export declare class ApiError extends Error {
    statusCode: number;
    isOperational: boolean;
    constructor(message: string, statusCode: number, isOperational?: boolean);
}
export declare class ValidationError extends ApiError {
    constructor(message: string);
}
export declare class AuthenticationError extends ApiError {
    constructor(message?: string);
}
export declare class AuthorizationError extends ApiError {
    constructor(message?: string);
}
export declare class NotFoundError extends ApiError {
    constructor(resource: string);
}
export declare class ConflictError extends ApiError {
    constructor(message: string);
}
export declare class DatabaseError extends ApiError {
    constructor(message?: string);
}
//# sourceMappingURL=errors.d.ts.map