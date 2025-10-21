import { Server as SocketServer } from 'socket.io';
import { Server } from 'http';
export declare class WebSocketService {
    private static instance;
    private io;
    private userSockets;
    private constructor();
    static initialize(server: Server): WebSocketService;
    static getInstance(): WebSocketService;
    private setupMiddleware;
    private setupEventHandlers;
    private addUserSocket;
    private removeUserSocket;
    /**
     * Send notification to specific user
     */
    sendToUser(userId: string, event: string, data: any): void;
    /**
     * Send notification to multiple users
     */
    sendToUsers(userIds: string[], event: string, data: any): void;
    /**
     * Broadcast to all users in a venue
     */
    broadcastToVenue(venueId: string, event: string, data: any): void;
    /**
     * Broadcast to all users in a city
     */
    broadcastToCity(cityId: string, event: string, data: any): void;
    /**
     * Broadcast to all connected users
     */
    broadcastToAll(event: string, data: any): void;
    /**
     * Get connected users count
     */
    getConnectedUsersCount(): number;
    /**
     * Check if user is online
     */
    isUserOnline(userId: string): boolean;
    /**
     * Get all online users
     */
    getOnlineUsers(): string[];
    /**
     * Send real-time recommendation update
     */
    sendRecommendationUpdate(userId: string, recommendations: any[]): void;
    /**
     * Send trending update to city subscribers
     */
    sendTrendingUpdate(cityId: string, trending: any[]): void;
    /**
     * Send notification about new list
     */
    sendNewListNotification(cityId: string, list: any): void;
    /**
     * Send venue update notification
     */
    sendVenueUpdate(venueId: string, update: any): void;
    /**
     * Get socket server instance (for advanced use)
     */
    getIO(): SocketServer;
}
export declare const WSEvents: {
    CONNECTED: string;
    DISCONNECTED: string;
    ERROR: string;
    VENUE_ACTIVITY: string;
    VENUE_UPDATE: string;
    VENUE_TRENDING: string;
    USER_TYPING: string;
    USER_ONLINE: string;
    USER_OFFLINE: string;
    RECOMMENDATIONS_UPDATE: string;
    RECOMMENDATIONS_NEW: string;
    LIST_NEW: string;
    LIST_UPDATE: string;
    LIST_DELETE: string;
    NOTIFICATION: string;
    ALERT: string;
    COMMENT_NEW: string;
    LIKE_NEW: string;
    SHARE_NEW: string;
};
//# sourceMappingURL=websocket.service.d.ts.map