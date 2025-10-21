import { Request, Response, NextFunction } from 'express';
interface PerformanceMetrics {
    endpoint: string;
    method: string;
    duration: number;
    timestamp: Date;
    statusCode: number;
}
export declare const performanceMiddleware: (req: Request, res: Response, next: NextFunction) => void;
export declare const getMetrics: () => PerformanceMetrics[];
export declare const clearMetrics: () => number;
export {};
//# sourceMappingURL=performance.d.ts.map