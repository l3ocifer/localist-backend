import { Server } from 'http';
export declare class GracefulShutdown {
    private server;
    private isShuttingDown;
    private connections;
    constructor(server: Server);
    private setupHandlers;
    private trackConnections;
    private shutdown;
    private cleanup;
}
export default GracefulShutdown;
//# sourceMappingURL=graceful-shutdown.d.ts.map