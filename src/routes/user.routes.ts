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
  body('preferences').isObject()
], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  const { preferences } = req.body;
  
  try {
    await pool.query(
      'UPDATE users SET preferences = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(preferences), req.userId]
    );
    
    return res.json({ message: 'Preferences updated successfully' });
  } catch (error) {
    console.error('Update preferences error:', error);
    return res.status(500).json({ error: 'Failed to update preferences' });
  }
});

export default router;