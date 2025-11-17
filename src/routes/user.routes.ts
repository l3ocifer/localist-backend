import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateToken);

router.get('/lists', async (req: AuthRequest, res: Response) => {
  try {
    const lists = await pool.query(
      `SELECT id, name, description, venue_ids, is_public, created_at, updated_at
       FROM user_lists 
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.userId]
    );
    
    return res.json({
      lists: lists.rows
    });
  } catch (error) {
    console.error('Get user lists error:', error);
    return res.status(500).json({ error: 'Failed to fetch lists' });
  }
});

router.post('/lists', [
  body('name').trim().isLength({ min: 1, max: 200 }),
  body('description').optional().trim(),
  body('is_public').optional().isBoolean()
], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  const { name, description, is_public = false } = req.body;
  const listId = `ul_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const newList = await pool.query(
      `INSERT INTO user_lists (id, user_id, name, description, is_public)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, is_public, venue_ids, created_at`,
      [listId, req.userId, name, description, is_public]
    );
    
    return res.status(201).json({
      list: newList.rows[0]
    });
  } catch (error) {
    console.error('Create user list error:', error);
    return res.status(500).json({ error: 'Failed to create list' });
  }
});

router.get('/lists/:listId', async (req: AuthRequest, res: Response) => {
  const { listId } = req.params;
  
  try {
    const list = await pool.query(
      `SELECT id, name, description, venue_ids, is_public, created_at, updated_at
       FROM user_lists 
       WHERE id = $1 AND user_id = $2`,
      [listId, req.userId]
    );
    
    if (list.rows.length === 0) {
      return res.status(404).json({ error: 'List not found' });
    }
    
    const venueIds = list.rows[0].venue_ids || [];
    let venues = [];
    
    if (venueIds.length > 0) {
      const venuesResult = await pool.query(
        `SELECT id, name, category, cuisine, price_range, rating, image_url
         FROM venues 
         WHERE id = ANY($1::text[])`,
        [venueIds]
      );
      venues = venuesResult.rows;
    }
    
    return res.json({
      list: {
        ...list.rows[0],
        venues
      }
    });
  } catch (error) {
    console.error('Get user list error:', error);
    return res.status(500).json({ error: 'Failed to fetch list' });
  }
});

router.put('/lists/:listId', [
  body('name').optional().trim().isLength({ min: 1, max: 200 }),
  body('description').optional().trim(),
  body('is_public').optional().isBoolean(),
  body('venue_ids').optional().isArray()
], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  const { listId } = req.params;
  const { name, description, is_public, venue_ids } = req.body;
  
  try {
    let updateFields = [];
    let updateValues = [];
    let paramCount = 0;
    
    if (name !== undefined) {
      updateFields.push(`name = $${++paramCount}`);
      updateValues.push(name);
    }
    
    if (description !== undefined) {
      updateFields.push(`description = $${++paramCount}`);
      updateValues.push(description);
    }
    
    if (is_public !== undefined) {
      updateFields.push(`is_public = $${++paramCount}`);
      updateValues.push(is_public);
    }
    
    if (venue_ids !== undefined) {
      updateFields.push(`venue_ids = $${++paramCount}`);
      updateValues.push(venue_ids);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updateValues.push(listId, req.userId);
    
    const updateQuery = `
      UPDATE user_lists 
      SET ${updateFields.join(', ')}, updated_at = NOW()
      WHERE id = $${++paramCount} AND user_id = $${++paramCount}
      RETURNING id, name, description, is_public, venue_ids, updated_at
    `;
    
    const result = await pool.query(updateQuery, updateValues);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'List not found' });
    }
    
    return res.json({
      list: result.rows[0]
    });
  } catch (error) {
    console.error('Update user list error:', error);
    return res.status(500).json({ error: 'Failed to update list' });
  }
});

router.delete('/lists/:listId', async (req: AuthRequest, res: Response) => {
  const { listId } = req.params;
  
  try {
    const result = await pool.query(
      'DELETE FROM user_lists WHERE id = $1 AND user_id = $2 RETURNING id',
      [listId, req.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'List not found' });
    }
    
    return res.json({ message: 'List deleted successfully' });
  } catch (error) {
    console.error('Delete user list error:', error);
    return res.status(500).json({ error: 'Failed to delete list' });
  }
});

router.get('/favorites', async (req: AuthRequest, res: Response) => {
  try {
    const favorites = await pool.query(
      `SELECT v.id, v.name, v.category, v.cuisine, v.price_range, v.rating, v.image_url, v.address
       FROM user_favorites uf
       JOIN venues v ON uf.venue_id = v.id
       WHERE uf.user_id = $1
       ORDER BY uf.created_at DESC`,
      [req.userId]
    );
    
    return res.json({
      favorites: favorites.rows
    });
  } catch (error) {
    console.error('Get favorites error:', error);
    return res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

router.post('/favorites/:venueId', async (req: AuthRequest, res: Response) => {
  const { venueId } = req.params;
  
  try {
    await pool.query(
      'INSERT INTO user_favorites (user_id, venue_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.userId, venueId]
    );
    
    return res.status(201).json({ message: 'Added to favorites' });
  } catch (error) {
    console.error('Add favorite error:', error);
    return res.status(500).json({ error: 'Failed to add favorite' });
  }
});

router.delete('/favorites/:venueId', async (req: AuthRequest, res: Response) => {
  const { venueId } = req.params;
  
  try {
    await pool.query(
      'DELETE FROM user_favorites WHERE user_id = $1 AND venue_id = $2',
      [req.userId, venueId]
    );
    
    return res.json({ message: 'Removed from favorites' });
  } catch (error) {
    console.error('Remove favorite error:', error);
    return res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

router.get('/profile', async (req: AuthRequest, res: Response) => {
  try {
    const user = await pool.query(
      'SELECT id, email, first_name, last_name, phone, preferences, is_premium FROM users WHERE id = $1',
      [req.userId]
    );
    
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.json({
      profile: user.rows[0]
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.put('/profile', [
  body('first_name').optional().trim().isLength({ min: 1, max: 100 }),
  body('last_name').optional().trim().isLength({ min: 1, max: 100 }),
  body('phone').optional().isMobilePhone('any')
], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  const { first_name, last_name, phone } = req.body;
  
  try {
    const updateFields = [];
    const updateValues = [];
    let paramCount = 0;
    
    if (first_name !== undefined) {
      updateFields.push(`first_name = $${++paramCount}`);
      updateValues.push(first_name);
    }
    
    if (last_name !== undefined) {
      updateFields.push(`last_name = $${++paramCount}`);
      updateValues.push(last_name);
    }
    
    if (phone !== undefined) {
      updateFields.push(`phone = $${++paramCount}`);
      updateValues.push(phone);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updateValues.push(req.userId);
    
    const result = await pool.query(
      `UPDATE users 
       SET ${updateFields.join(', ')}, updated_at = NOW()
       WHERE id = $${++paramCount}
       RETURNING id, email, first_name, last_name, phone`,
      updateValues
    );
    
    return res.json({
      profile: result.rows[0]
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.put('/preferences', [
  body('preferences').isObject(),
  body('onboarding_completed').optional().isBoolean()
], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  const { preferences, onboarding_completed } = req.body;
  
  try {
    let updateFields = [];
    let updateValues = [];
    let paramCount = 0;
    
    if (preferences !== undefined) {
      updateFields.push(`preferences = $${++paramCount}`);
      updateValues.push(JSON.stringify(preferences));
    }
    
    if (onboarding_completed !== undefined) {
      updateFields.push(`onboarding_completed = $${++paramCount}`);
      updateValues.push(onboarding_completed);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updateValues.push(req.userId);
    updateFields.push('updated_at = NOW()');
    
    await pool.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${++paramCount}`,
      updateValues
    );
    
    return res.json({ message: 'Preferences updated successfully' });
  } catch (error) {
    console.error('Update preferences error:', error);
    return res.status(500).json({ error: 'Failed to update preferences' });
  }
});

router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    // Get lists created count
    const listsCount = await pool.query(
      'SELECT COUNT(*) as count FROM user_lists WHERE user_id = $1',
      [req.userId]
    );

    // Get venues saved count
    const favoritesCount = await pool.query(
      'SELECT COUNT(*) as count FROM user_favorites WHERE user_id = $1',
      [req.userId]
    );

    // Get total interactions count
    const interactionsCount = await pool.query(
      'SELECT COUNT(*) as count FROM user_interactions WHERE user_id = $1',
      [req.userId]
    );

    return res.json({
      stats: {
        listsCreated: parseInt(listsCount.rows[0].count) || 0,
        venuesSaved: parseInt(favoritesCount.rows[0].count) || 0,
        totalInteractions: parseInt(interactionsCount.rows[0].count) || 0,
      }
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.post('/lists/:listId/clone', async (req: AuthRequest, res: Response) => {
  const { listId } = req.params;
  
  try {
    // Get the original list (can be from user_lists or public lists)
    const originalList = await pool.query(
      `SELECT id, name, description, venue_ids, is_public
       FROM user_lists 
       WHERE id = $1 AND is_public = true`,
      [listId]
    );
    
    if (originalList.rows.length === 0) {
      // Try public lists table
      const publicList = await pool.query(
        `SELECT id, name, description, venue_ids
         FROM lists 
         WHERE id = $1`,
        [listId]
      );
      
      if (publicList.rows.length === 0) {
        return res.status(404).json({ error: 'List not found' });
      }
      
      // Clone from public list
      const newListId = `ul_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const clonedList = await pool.query(
        `INSERT INTO user_lists (id, user_id, name, description, venue_ids, is_public)
         VALUES ($1, $2, $3, $4, $5, false)
         RETURNING id, name, description, venue_ids, is_public, created_at`,
        [
          newListId,
          req.userId,
          `${publicList.rows[0].name} (Copy)`,
          publicList.rows[0].description,
          publicList.rows[0].venue_ids || []
        ]
      );
      
      return res.status(201).json({
        list: clonedList.rows[0]
      });
    }
    
    // Clone from user_lists
    const newListId = `ul_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const clonedList = await pool.query(
      `INSERT INTO user_lists (id, user_id, name, description, venue_ids, is_public)
       VALUES ($1, $2, $3, $4, $5, false)
       RETURNING id, name, description, venue_ids, is_public, created_at`,
      [
        newListId,
        req.userId,
        `${originalList.rows[0].name} (Copy)`,
        originalList.rows[0].description,
        originalList.rows[0].venue_ids || []
      ]
    );
    
    return res.status(201).json({
      list: clonedList.rows[0]
    });
  } catch (error) {
    console.error('Clone list error:', error);
    return res.status(500).json({ error: 'Failed to clone list' });
  }
});

// Generate or get share token for a list
router.post('/lists/:listId/share', async (req: AuthRequest, res: Response) => {
  const { listId } = req.params;
  
  try {
    // Verify list belongs to user
    const list = await pool.query(
      'SELECT id, is_public FROM user_lists WHERE id = $1 AND user_id = $2',
      [listId, req.userId]
    );
    
    if (list.rows.length === 0) {
      return res.status(404).json({ error: 'List not found' });
    }
    
    // Generate share token if doesn't exist
    let shareToken = list.rows[0].share_token;
    if (!shareToken) {
      const crypto = require('crypto');
      shareToken = crypto.randomBytes(32).toString('hex');
      await pool.query(
        'UPDATE user_lists SET share_token = $1 WHERE id = $2',
        [shareToken, listId]
      );
    }
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3005';
    const shareUrl = `${frontendUrl}/lists/share/${shareToken}`;
    
    return res.json({
      shareUrl,
      shareToken
    });
  } catch (error) {
    console.error('Generate share URL error:', error);
    return res.status(500).json({ error: 'Failed to generate share URL' });
  }
});

export default router;