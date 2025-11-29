import { Request, Response, Router } from 'express';
import { AuthRequest, authenticateToken } from '../middleware/auth.middleware';
import { RecommendationService } from '../services/recommendations.service';

const router = Router();
const recommendationService = RecommendationService.getInstance();

/**
 * Get personalized recommendations for authenticated user
 */
router.get('/personalized', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { cityId, limit = 10 } = req.query;

  if (!cityId) {
    return res.status(400).json({ error: 'City ID is required' });
  }

  try {
    const recommendations = await recommendationService.getPersonalizedRecommendations(
      req.userId!,
      cityId as string,
      Number(limit)
    );

    return res.json({
      recommendations,
      type: 'personalized',
    });
  } catch (error) {
    console.error('Error getting personalized recommendations:', error);
    return res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

/**
 * Get collaborative filtering recommendations
 */
router.get('/collaborative', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { cityId, limit = 10 } = req.query;

  if (!cityId) {
    return res.status(400).json({ error: 'City ID is required' });
  }

  try {
    const recommendations = await recommendationService.getCollaborativeRecommendations(
      req.userId!,
      cityId as string,
      Number(limit)
    );

    return res.json({
      recommendations,
      type: 'collaborative',
    });
  } catch (error) {
    console.error('Error getting collaborative recommendations:', error);
    return res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

/**
 * Get content-based recommendations
 */
router.get('/content', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { cityId, limit = 10 } = req.query;

  if (!cityId) {
    return res.status(400).json({ error: 'City ID is required' });
  }

  try {
    const recommendations = await recommendationService.getContentBasedRecommendations(
      req.userId!,
      cityId as string,
      Number(limit)
    );

    return res.json({
      recommendations,
      type: 'content',
    });
  } catch (error) {
    console.error('Error getting content-based recommendations:', error);
    return res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

/**
 * Get hybrid recommendations (best of all algorithms)
 */
router.get('/hybrid', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { cityId, limit = 10 } = req.query;

  if (!cityId) {
    return res.status(400).json({ error: 'City ID is required' });
  }

  try {
    const result = await recommendationService.getHybridRecommendations(
      req.userId!,
      cityId as string,
      Number(limit)
    );

    return res.json({
      recommendations: result.recommendations,
      type: 'hybrid',
      methodology: result.methodology,
    });
  } catch (error) {
    console.error('Error getting hybrid recommendations:', error);
    return res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

/**
 * Get trending venues (cityId optional for global trending)
 */
router.get('/trending', async (req: Request, res: Response) => {
  const { cityId, limit = 10 } = req.query;

  try {
    const trending = await recommendationService.getTrendingVenues(
      cityId as string | undefined,
      Number(limit)
    );

    return res.json({
      venues: trending,
      recommendations: trending, // Also include as recommendations for compatibility
      type: 'trending',
    });
  } catch (error) {
    console.error('Error getting trending venues:', error);
    return res.status(500).json({ error: 'Failed to get trending venues' });
  }
});

/**
 * Get recommendations for new users (cold start)
 */
router.post('/cold-start', async (req: Request, res: Response) => {
  const { cityId, preferences, limit = 10 } = req.body;

  if (!cityId) {
    return res.status(400).json({ error: 'City ID is required' });
  }

  try {
    const recommendations = await recommendationService.getColdStartRecommendations(
      cityId,
      preferences,
      limit
    );

    return res.json({
      recommendations,
      type: 'cold-start',
    });
  } catch (error) {
    console.error('Error getting cold start recommendations:', error);
    return res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

/**
 * Track user interaction with a venue
 */
router.post('/track', authenticateToken, async (req: AuthRequest, res: Response) => {
  const {
    venueId,
    action,
    duration,
    rating,
    context,
    source,
    timeOfDay,
    dayOfWeek,
    listId,
    cityId,
    sessionId,
    deviceType,
  } = req.body;

  if (!venueId || !action) {
    return res.status(400).json({ error: 'Venue ID and action are required' });
  }

  const validActions = ['view', 'save', 'share', 'visit', 'favorite'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: 'Invalid action type' });
  }

  try {
    // Extract request metadata
    const forwardedFor = req.headers['x-forwarded-for'];
    const ipAddress =
      req.ip ||
      (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) ||
      req.socket.remoteAddress ||
      undefined;
    const userAgent = req.headers['user-agent'] || undefined;
    const referrerHeader = req.headers['referer'] || req.headers['referrer'];
    const referrer = Array.isArray(referrerHeader)
      ? referrerHeader[0]
      : referrerHeader || undefined;

    await recommendationService.trackInteraction(req.userId!, venueId, action, {
      duration,
      rating,
      context,
      source,
      timeOfDay,
      dayOfWeek,
      ipAddress,
      userAgent,
      referrer,
      listId,
      cityId,
      sessionId,
      deviceType,
    });

    return res.json({ message: 'Interaction tracked successfully' });
  } catch (error) {
    console.error('Error tracking interaction:', error);
    return res.status(500).json({ error: 'Failed to track interaction' });
  }
});

export default router;
