import pool from '../config/database';
import logger from './logger.service';
import { v4 as uuidv4 } from 'uuid';

export interface ReviewQueueItem {
  id: string;
  contentType: 'venue' | 'list' | 'review' | 'image';
  contentId: string;
  sourceId?: string;
  status: 'pending' | 'in_review' | 'approved' | 'rejected' | 'needs_changes';
  priority: number;
  contentSnapshot: any;
  submittedBy?: string;
  reviewedBy?: string;
  reviewNotes?: string;
  requiresManualReview: boolean;
  isDuplicate: boolean;
  duplicateOfId?: string;
}

export class ReviewQueueService {
  /**
   * Add item to review queue
   */
  async addToQueue(
    contentType: 'venue' | 'list' | 'review' | 'image',
    contentId: string,
    contentSnapshot: any,
    options?: {
      sourceId?: string;
      priority?: number;
      submittedBy?: string;
      requiresManualReview?: boolean;
    }
  ): Promise<string> {
    const queueId = uuidv4();

    try {
      await pool.query(
        `INSERT INTO content_review_queue (
          id, content_type, content_id, source_id, status, priority,
          content_snapshot, submitted_by, requires_manual_review
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          queueId,
          contentType,
          contentId,
          options?.sourceId || null,
          'pending',
          options?.priority || 5,
          JSON.stringify(contentSnapshot),
          options?.submittedBy || null,
          options?.requiresManualReview || false
        ]
      );

      logger.info(`Added ${contentType} ${contentId} to review queue`, { queueId });
      return queueId;
    } catch (error) {
      logger.error('Failed to add item to review queue', error);
      throw error;
    }
  }

  /**
   * Get review queue items
   */
  async getQueue(filters?: {
    status?: string;
    contentType?: string;
    priority?: number;
    requiresManualReview?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ReviewQueueItem[]; total: number }> {
    let query = 'SELECT * FROM content_review_queue WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;

    if (filters?.status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(filters.status);
    }

    if (filters?.contentType) {
      paramCount++;
      query += ` AND content_type = $${paramCount}`;
      params.push(filters.contentType);
    }

    if (filters?.priority !== undefined) {
      paramCount++;
      query += ` AND priority <= $${paramCount}`;
      params.push(filters.priority);
    }

    if (filters?.requiresManualReview !== undefined) {
      paramCount++;
      query += ` AND requires_manual_review = $${paramCount}`;
      params.push(filters.requiresManualReview);
    }

    query += ' ORDER BY priority ASC, created_at ASC';

    if (filters?.limit) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(filters.limit);
    }

    if (filters?.offset) {
      paramCount++;
      query += ` OFFSET $${paramCount}`;
      params.push(filters.offset);
    }

    const result = await pool.query(query, params);

    // Get total count
    const countQuery = query.replace(/SELECT \*/, 'SELECT COUNT(*)').split('ORDER BY')[0];
    const countResult = await pool.query(countQuery, params.slice(0, -2));

    const items = result.rows.map(row => ({
      id: row.id,
      contentType: row.content_type,
      contentId: row.content_id,
      sourceId: row.source_id,
      status: row.status,
      priority: row.priority,
      contentSnapshot: row.content_snapshot,
      submittedBy: row.submitted_by,
      reviewedBy: row.reviewed_by,
      reviewNotes: row.review_notes,
      requiresManualReview: row.requires_manual_review,
      isDuplicate: row.is_duplicate,
      duplicateOfId: row.duplicate_of_id
    }));

    return {
      items,
      total: parseInt(countResult.rows[0].count)
    };
  }

  /**
   * Approve item
   */
  async approveItem(queueId: string, reviewedBy: string, notes?: string): Promise<boolean> {
    try {
      const result = await pool.query(
        `UPDATE content_review_queue 
         SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3
         WHERE id = $4 AND (status = 'pending' OR status = 'in_review')`,
        ['approved', reviewedBy, notes || null, queueId]
      );

      if (result.rowCount === 0) {
        return false;
      }

      logger.info(`Approved review queue item ${queueId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to approve review queue item ${queueId}`, error);
      throw error;
    }
  }

  /**
   * Reject item
   */
  async rejectItem(queueId: string, reviewedBy: string, notes?: string): Promise<boolean> {
    try {
      const result = await pool.query(
        `UPDATE content_review_queue 
         SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3
         WHERE id = $4 AND (status = 'pending' OR status = 'in_review')`,
        ['rejected', reviewedBy, notes || null, queueId]
      );

      if (result.rowCount === 0) {
        return false;
      }

      logger.info(`Rejected review queue item ${queueId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to reject review queue item ${queueId}`, error);
      throw error;
    }
  }

  /**
   * Mark as needs changes
   */
  async markNeedsChanges(queueId: string, reviewedBy: string, notes: string): Promise<boolean> {
    try {
      const result = await pool.query(
        `UPDATE content_review_queue 
         SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3
         WHERE id = $4`,
        ['needs_changes', reviewedBy, notes, queueId]
      );

      if (result.rowCount === 0) {
        return false;
      }

      logger.info(`Marked review queue item ${queueId} as needs changes`);
      return true;
    } catch (error) {
      logger.error(`Failed to mark review queue item ${queueId}`, error);
      throw error;
    }
  }

  /**
   * Mark as duplicate
   */
  async markDuplicate(queueId: string, duplicateOfId: string, reviewedBy: string): Promise<boolean> {
    try {
      const result = await pool.query(
        `UPDATE content_review_queue 
         SET status = $1, is_duplicate = $2, duplicate_of_id = $3, 
             reviewed_by = $4, reviewed_at = NOW()
         WHERE id = $5`,
        ['rejected', true, duplicateOfId, reviewedBy, queueId]
      );

      if (result.rowCount === 0) {
        return false;
      }

      logger.info(`Marked review queue item ${queueId} as duplicate of ${duplicateOfId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to mark review queue item ${queueId} as duplicate`, error);
      throw error;
    }
  }
}

