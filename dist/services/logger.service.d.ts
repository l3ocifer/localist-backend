declare class LoggerService {
    private logger;
    private static instance;
    private constructor();
    static getInstance(): LoggerService;
    error(message: string, meta?: any): void;
    warn(message: string, meta?: any): void;
    info(message: string, meta?: any): void;
    http(message: string, meta?: any): void;
    debug(message: string, meta?: any): void;
    logRequest(req: any, res: any, responseTime: number): void;
    logQuery(query: string, duration: number, success: boolean): void;
    logError(error: Error, context?: string): void;
    stream: {
        write: (message: string) => void;
    };
}
export declare const logger: LoggerService;
export default logger;
//# sourceMappingURL=logger.service.d.ts.map