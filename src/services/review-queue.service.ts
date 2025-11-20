import pool from '../config/database';
import { v4 as uuidv4 } from 'uuid';

export interface ReviewQueueItem {
  id: string;
  entity_type: 'venue' | 'list' | 'event';
  entity_id?: string;
  source?: string;
  change_type: 'new' | 'update' | 'delete';
  data_snapshot: any;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: string;
  reviewed_at?: Date;
  rejection_reason?: string;
  created_at: Date;
}

export class ReviewQueueService {
  private static instance: ReviewQueueService;

  private constructor() {}

  static getInstance(): ReviewQueueService {
    if (!ReviewQueueService.instance) {
      ReviewQueueService.instance = new ReviewQueueService();
    }
    return ReviewQueueService.instance;
  }

  /**
   * Get pending review items
   */
  async getPendingItems(limit: number = 50, offset: number = 0): Promise<{ items: ReviewQueueItem[], total: number }> {
    const result = await pool.query(
      `SELECT * FROM content_review_queue 
       WHERE status = 'pending' 
       ORDER BY created_at ASC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM content_review_queue WHERE status = 'pending'`
    );

    return {
      items: result.rows,
      total: parseInt(countResult.rows[0].count)
    };
  }

  /**
   * Approve an item
   */
  async approveItem(id: string, userId: string): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get the item
      const itemResult = await client.query(
        'SELECT * FROM content_review_queue WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (itemResult.rows.length === 0) {
        throw new Error('Item not found');
      }

      const item = itemResult.rows[0];

      if (item.status !== 'pending') {
        throw new Error('Item is not pending review');
      }

      // Apply the change based on entity type
      if (item.entity_type === 'venue' && item.change_type === 'new') {
        await this.applyNewVenue(client, item.data_snapshot);
      } else if (item.entity_type === 'venue' && item.change_type === 'update') {
        await this.applyUpdateVenue(client, item.entity_id, item.data_snapshot);
      }
      // Add other entity types as needed

      // Update queue status
      await client.query(
        `UPDATE content_review_queue 
         SET status = 'approved', reviewed_by = $1, reviewed_at = NOW() 
         WHERE id = $2`,
        [userId, id]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Reject an item
   */
  async rejectItem(id: string, userId: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE content_review_queue 
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2
       WHERE id = $3`,
      [userId, reason, id]
    );
  }

  private async applyNewVenue(client: any, data: any): Promise<void> {
    const id = uuidv4();
    await client.query(
      `INSERT INTO venues (
        id, name, city_id, category, cuisine, price_range, description,
        address, phone, website, image_url, rating, coordinates, hours, features
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id,
        data.name,
        data.city_id,
        data.category,
        data.cuisine,
        data.price_range,
        data.description,
        data.address,
        data.phone,
        data.website,
        data.image_url,
        data.rating,
        JSON.stringify(data.coordinates),
        JSON.stringify(data.hours),
        data.features
      ]
    );
  }

  private async applyUpdateVenue(client: any, id: string, data: any): Promise<void> {
    // Dynamic update query
    const fields = Object.keys(data).map((key, i) => `${key} = $${i + 2}`);
    const values = Object.values(data);
    
    await client.query(
      `UPDATE venues SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $1`,
      [id, ...values]
    );
  }
}

