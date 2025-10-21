import { Server as SocketServer, Socket } from 'socket.io';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import config from '../config';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userData?: any;
}

export class WebSocketService {
  private static instance: WebSocketService;
  private io: SocketServer;
  private userSockets: Map<string, Set<string>> = new Map();

  private constructor(server: Server) {
    this.io = new SocketServer(server, {
      cors: {
        origin: config.cors.origin,
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  static initialize(server: Server): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService(server);
    }
    return WebSocketService.instance;
  }

  static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      throw new Error('WebSocketService not initialized. Call initialize() first.');
    }
    return WebSocketService.instance;
  }

  private setupMiddleware(): void {
    this.io.use((socket: AuthenticatedSocket, next) => {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      try {
        const decoded = jwt.verify(token as string, config.jwt.secret) as any;
        socket.userId = decoded.userId;
        socket.userData = decoded;
        next();
      } catch (err) {
        next(new Error('Invalid token'));
      }
    });
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
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
      socket.on('join:venue', (venueId: string) => {
        socket.join(`venue:${venueId}`);
        console.log(`User ${socket.userId} joined venue room: ${venueId}`);
      });

      socket.on('leave:venue', (venueId: string) => {
        socket.leave(`venue:${venueId}`);
        console.log(`User ${socket.userId} left venue room: ${venueId}`);
      });

      // Handle joining city rooms for city-wide updates
      socket.on('join:city', (cityId: string) => {
        socket.join(`city:${cityId}`);
        console.log(`User ${socket.userId} joined city room: ${cityId}`);
      });

      socket.on('leave:city', (cityId: string) => {
        socket.leave(`city:${cityId}`);
        console.log(`User ${socket.userId} left city room: ${cityId}`);
      });

      // Handle real-time venue interactions
      socket.on('venue:interaction', async (data: {
        venueId: string;
        action: string;
        cityId?: string;
      }) => {
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
      socket.on('typing:start', (data: { context: string; contextId: string }) => {
        socket.to(`${data.context}:${data.contextId}`).emit('user:typing', {
          userId: socket.userId,
          isTyping: true,
        });
      });

      socket.on('typing:stop', (data: { context: string; contextId: string }) => {
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

  private addUserSocket(userId: string, socketId: string): void {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socketId);
  }

  private removeUserSocket(userId: string, socketId: string): void {
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
  sendToUser(userId: string, event: string, data: any): void {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  /**
   * Send notification to multiple users
   */
  sendToUsers(userIds: string[], event: string, data: any): void {
    userIds.forEach(userId => {
      this.sendToUser(userId, event, data);
    });
  }

  /**
   * Broadcast to all users in a venue
   */
  broadcastToVenue(venueId: string, event: string, data: any): void {
    this.io.to(`venue:${venueId}`).emit(event, data);
  }

  /**
   * Broadcast to all users in a city
   */
  broadcastToCity(cityId: string, event: string, data: any): void {
    this.io.to(`city:${cityId}`).emit(event, data);
  }

  /**
   * Broadcast to all connected users
   */
  broadcastToAll(event: string, data: any): void {
    this.io.emit(event, data);
  }

  /**
   * Get connected users count
   */
  getConnectedUsersCount(): number {
    return this.userSockets.size;
  }

  /**
   * Check if user is online
   */
  isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId);
  }

  /**
   * Get all online users
   */
  getOnlineUsers(): string[] {
    return Array.from(this.userSockets.keys());
  }

  /**
   * Send real-time recommendation update
   */
  sendRecommendationUpdate(userId: string, recommendations: any[]): void {
    this.sendToUser(userId, 'recommendations:update', {
      recommendations,
      timestamp: new Date(),
    });
  }

  /**
   * Send trending update to city subscribers
   */
  sendTrendingUpdate(cityId: string, trending: any[]): void {
    this.broadcastToCity(cityId, 'trending:venues', {
      venues: trending,
      timestamp: new Date(),
    });
  }

  /**
   * Send notification about new list
   */
  sendNewListNotification(cityId: string, list: any): void {
    this.broadcastToCity(cityId, 'list:new', {
      list,
      timestamp: new Date(),
    });
  }

  /**
   * Send venue update notification
   */
  sendVenueUpdate(venueId: string, update: any): void {
    this.broadcastToVenue(venueId, 'venue:update', {
      ...update,
      timestamp: new Date(),
    });
  }

  /**
   * Get socket server instance (for advanced use)
   */
  getIO(): SocketServer {
    return this.io;
  }
}

// WebSocket event types
export const WSEvents = {
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