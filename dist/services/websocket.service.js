"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WSEvents = exports.WebSocketService = void 0;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = __importDefault(require("../config"));
class WebSocketService {
    static instance;
    io;
    userSockets = new Map();
    constructor(server) {
        this.io = new socket_io_1.Server(server, {
            cors: {
                origin: config_1.default.cors.origin,
                credentials: true,
            },
            transports: ['websocket', 'polling'],
        });
        this.setupMiddleware();
        this.setupEventHandlers();
    }
    static initialize(server) {
        if (!WebSocketService.instance) {
            WebSocketService.instance = new WebSocketService(server);
        }
        return WebSocketService.instance;
    }
    static getInstance() {
        if (!WebSocketService.instance) {
            throw new Error('WebSocketService not initialized. Call initialize() first.');
        }
        return WebSocketService.instance;
    }
    setupMiddleware() {
        this.io.use((socket, next) => {
            const token = socket.handshake.auth.token || socket.handshake.query.token;
            if (!token) {
                return next(new Error('Authentication required'));
            }
            try {
                const decoded = jsonwebtoken_1.default.verify(token, config_1.default.jwt.secret);
                socket.userId = decoded.userId;
                socket.userData = decoded;
                next();
            }
            catch (err) {
                next(new Error('Invalid token'));
            }
        });
    }
    setupEventHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`User ${socket.userId} connected via WebSocket`);
            if (socket.userId) {
                this.addUserSocket(socket.userId, socket.id);
                socket.join(`user:${socket.userId}`);
                socket.emit('connected', {
                    message: 'Successfully connected to WebSocket',
                    userId: socket.userId,
                });
            }
            // Handle joining venue rooms for real-time updates
            socket.on('join:venue', (venueId) => {
                socket.join(`venue:${venueId}`);
                console.log(`User ${socket.userId} joined venue room: ${venueId}`);
            });
            socket.on('leave:venue', (venueId) => {
                socket.leave(`venue:${venueId}`);
                console.log(`User ${socket.userId} left venue room: ${venueId}`);
            });
            // Handle joining city rooms for city-wide updates
            socket.on('join:city', (cityId) => {
                socket.join(`city:${cityId}`);
                console.log(`User ${socket.userId} joined city room: ${cityId}`);
            });
            socket.on('leave:city', (cityId) => {
                socket.leave(`city:${cityId}`);
                console.log(`User ${socket.userId} left city room: ${cityId}`);
            });
            // Handle real-time venue interactions
            socket.on('venue:interaction', async (data) => {
                // Broadcast to other users viewing the same venue
                socket.to(`venue:${data.venueId}`).emit('venue:activity', {
                    userId: socket.userId,
                    venueId: data.venueId,
                    action: data.action,
                    timestamp: new Date(),
                });
                // Update trending data for the city
                if (data.cityId) {
                    this.io.to(`city:${data.cityId}`).emit('trending:update', {
                        venueId: data.venueId,
                        action: data.action,
                    });
                }
            });
            // Handle typing indicators for social features
            socket.on('typing:start', (data) => {
                socket.to(`${data.context}:${data.contextId}`).emit('user:typing', {
                    userId: socket.userId,
                    isTyping: true,
                });
            });
            socket.on('typing:stop', (data) => {
                socket.to(`${data.context}:${data.contextId}`).emit('user:typing', {
                    userId: socket.userId,
                    isTyping: false,
                });
            });
            // Handle disconnect
            socket.on('disconnect', () => {
                console.log(`User ${socket.userId} disconnected`);
                if (socket.userId) {
                    this.removeUserSocket(socket.userId, socket.id);
                }
            });
            // Handle errors
            socket.on('error', (error) => {
                console.error(`WebSocket error for user ${socket.userId}:`, error);
            });
        });
    }
    addUserSocket(userId, socketId) {
        if (!this.userSockets.has(userId)) {
            this.userSockets.set(userId, new Set());
        }
        this.userSockets.get(userId).add(socketId);
    }
    removeUserSocket(userId, socketId) {
        const sockets = this.userSockets.get(userId);
        if (sockets) {
            sockets.delete(socketId);
            if (sockets.size === 0) {
                this.userSockets.delete(userId);
            }
        }
    }
    /**
     * Send notification to specific user
     */
    sendToUser(userId, event, data) {
        this.io.to(`user:${userId}`).emit(event, data);
    }
    /**
     * Send notification to multiple users
     */
    sendToUsers(userIds, event, data) {
        userIds.forEach(userId => {
            this.sendToUser(userId, event, data);
        });
    }
    /**
     * Broadcast to all users in a venue
     */
    broadcastToVenue(venueId, event, data) {
        this.io.to(`venue:${venueId}`).emit(event, data);
    }
    /**
     * Broadcast to all users in a city
     */
    broadcastToCity(cityId, event, data) {
        this.io.to(`city:${cityId}`).emit(event, data);
    }
    /**
     * Broadcast to all connected users
     */
    broadcastToAll(event, data) {
        this.io.emit(event, data);
    }
    /**
     * Get connected users count
     */
    getConnectedUsersCount() {
        return this.userSockets.size;
    }
    /**
     * Check if user is online
     */
    isUserOnline(userId) {
        return this.userSockets.has(userId);
    }
    /**
     * Get all online users
     */
    getOnlineUsers() {
        return Array.from(this.userSockets.keys());
    }
    /**
     * Send real-time recommendation update
     */
    sendRecommendationUpdate(userId, recommendations) {
        this.sendToUser(userId, 'recommendations:update', {
            recommendations,
            timestamp: new Date(),
        });
    }
    /**
     * Send trending update to city subscribers
     */
    sendTrendingUpdate(cityId, trending) {
        this.broadcastToCity(cityId, 'trending:venues', {
            venues: trending,
            timestamp: new Date(),
        });
    }
    /**
     * Send notification about new list
     */
    sendNewListNotification(cityId, list) {
        this.broadcastToCity(cityId, 'list:new', {
            list,
            timestamp: new Date(),
        });
    }
    /**
     * Send venue update notification
     */
    sendVenueUpdate(venueId, update) {
        this.broadcastToVenue(venueId, 'venue:update', {
            ...update,
            timestamp: new Date(),
        });
    }
    /**
     * Get socket server instance (for advanced use)
     */
    getIO() {
        return this.io;
    }
}
exports.WebSocketService = WebSocketService;
// WebSocket event types
exports.WSEvents = {
    // Connection events
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    ERROR: 'error',
    // Venue events
    VENUE_ACTIVITY: 'venue:activity',
    VENUE_UPDATE: 'venue:update',
    VENUE_TRENDING: 'venue:trending',
    // User events
    USER_TYPING: 'user:typing',
    USER_ONLINE: 'user:online',
    USER_OFFLINE: 'user:offline',
    // Recommendation events
    RECOMMENDATIONS_UPDATE: 'recommendations:update',
    RECOMMENDATIONS_NEW: 'recommendations:new',
    // List events
    LIST_NEW: 'list:new',
    LIST_UPDATE: 'list:update',
    LIST_DELETE: 'list:delete',
    // Notification events
    NOTIFICATION: 'notification',
    ALERT: 'alert',
    // Social events
    COMMENT_NEW: 'comment:new',
    LIKE_NEW: 'like:new',
    SHARE_NEW: 'share:new',
};
//# sourceMappingURL=websocket.service.js.map