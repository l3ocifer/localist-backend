import { Router } from 'express';
import { Pool } from 'pg';
import { getAgentCoordinator } from '../agents/coordinator';
import logger from '../services/logger.service';

const router = Router();

/**
 * Admin routes for managing agents
 * 
 * These routes should be protected with admin authentication in production
 */

/**
 * GET /api/agents/status
 * Get status of all agents
 */
router.get('/status', async (req, res) => {
  try {
    const db = req.app.get('db') as Pool;
    const coordinator = getAgentCoordinator(db);
    
    const status = coordinator.getStatus();
    const agentsStatus = await coordinator.getAgentsStatus();
    
    res.json({
      coordinator: status,
      agents: agentsStatus
    });
  } catch (error) {
    logger.error('Failed to get agent status', error);
    res.status(500).json({ error: 'Failed to get agent status' });
  }
});

/**
 * GET /api/agents/:agentName/history
 * Get run history for a specific agent
 */
router.get('/:agentName/history', async (req, res) => {
  try {
    const { agentName } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;
    
    const db = req.app.get('db') as Pool;
    const coordinator = getAgentCoordinator(db);
    
    const history = await coordinator.getAgentRunHistory(agentName, limit);
    
    res.json({ agentName, history });
  } catch (error) {
    logger.error(`Failed to get agent history: ${req.params.agentName}`, error);
    res.status(500).json({ error: 'Failed to get agent history' });
  }
});

/**
 * POST /api/agents/:agentName/run
 * Manually trigger an agent run
 */
router.post('/:agentName/run', async (req, res) => {
  try {
    const { agentName } = req.params;
    
    const db = req.app.get('db') as Pool;
    const coordinator = getAgentCoordinator(db);
    
    // Run agent asynchronously
    coordinator.runAgent(agentName).catch(error => {
      logger.error(`Agent run failed: ${agentName}`, error);
    });
    
    res.json({ 
      message: `Agent ${agentName} execution started`,
      agentName 
    });
  } catch (error) {
    logger.error(`Failed to run agent: ${req.params.agentName}`, error);
    res.status(500).json({ error: 'Failed to run agent' });
  }
});

/**
 * POST /api/agents/run-pipeline
 * Run the full pipeline (hunters -> archivists -> curators)
 */
router.post('/run-pipeline', async (req, res) => {
  try {
    const db = req.app.get('db') as Pool;
    const coordinator = getAgentCoordinator(db);
    
    // Run pipeline asynchronously
    coordinator.runFullPipeline().catch(error => {
      logger.error('Pipeline execution failed', error);
    });
    
    res.json({ 
      message: 'Full pipeline execution started',
      phases: ['hunters', 'archivists', 'curators']
    });
  } catch (error) {
    logger.error('Failed to start pipeline', error);
    res.status(500).json({ error: 'Failed to start pipeline' });
  }
});

/**
 * POST /api/agents/:agentName/pause
 * Pause an agent
 */
router.post('/:agentName/pause', async (req, res) => {
  try {
    const { agentName } = req.params;
    
    const db = req.app.get('db') as Pool;
    const coordinator = getAgentCoordinator(db);
    
    await coordinator.pauseAgent(agentName);
    
    res.json({ 
      message: `Agent ${agentName} paused`,
      agentName 
    });
  } catch (error) {
    logger.error(`Failed to pause agent: ${req.params.agentName}`, error);
    res.status(500).json({ error: 'Failed to pause agent' });
  }
});

/**
 * POST /api/agents/:agentName/resume
 * Resume an agent
 */
router.post('/:agentName/resume', async (req, res) => {
  try {
    const { agentName } = req.params;
    const { cronExpression } = req.body;
    
    const db = req.app.get('db') as Pool;
    const coordinator = getAgentCoordinator(db);
    
    await coordinator.resumeAgent(agentName, cronExpression);
    
    res.json({ 
      message: `Agent ${agentName} resumed`,
      agentName,
      cronExpression 
    });
  } catch (error) {
    logger.error(`Failed to resume agent: ${req.params.agentName}`, error);
    res.status(500).json({ error: 'Failed to resume agent' });
  }
});

/**
 * GET /api/agents/data-quality
 * Get data quality metrics across all layers
 */
router.get('/data-quality', async (req, res) => {
  try {
    const db = req.app.get('db') as Pool;
    
    // Bronze layer metrics
    const bronzeMetrics = await db.query(`
      SELECT 
        source_id,
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE processing_status = 'processed') as processed,
        COUNT(*) FILTER (WHERE processing_status = 'error') as errors,
        MAX(ingested_at) as last_ingestion
      FROM bronze_venues
      GROUP BY source_id
    `);
    
    // Silver layer metrics
    const silverMetrics = await db.query(`
      SELECT
        city_id,
        COUNT(*) as total_venues,
        AVG(confidence_score) as avg_confidence,
        AVG(source_count) as avg_sources_per_venue,
        COUNT(*) FILTER (WHERE is_verified = true) as verified_venues
      FROM silver_venues
      GROUP BY city_id
    `);
    
    // Gold layer metrics
    const goldMetrics = await db.query(`
      SELECT
        gl.city_id,
        gl.category,
        COUNT(DISTINCT gl.id) as list_count,
        AVG(gli.final_score) as avg_list_score,
        SUM(gl.actual_venue_count) as total_venues
      FROM gold_lists gl
      LEFT JOIN gold_list_items gli ON gl.id = gli.gold_list_id
      WHERE gl.status = 'published'
      GROUP BY gl.city_id, gl.category
    `);
    
    res.json({
      bronze: bronzeMetrics.rows,
      silver: silverMetrics.rows,
      gold: goldMetrics.rows
    });
  } catch (error) {
    logger.error('Failed to get data quality metrics', error);
    res.status(500).json({ error: 'Failed to get data quality metrics' });
  }
});

/**
 * GET /api/agents/duplicates
 * Get potential duplicates that need review
 */
router.get('/duplicates', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const db = req.app.get('db') as Pool;
    
    const duplicates = await db.query(`
      SELECT 
        pd.id,
        pd.venue_a_id,
        pd.venue_b_id,
        pd.overall_similarity,
        pd.status,
        pd.created_at
      FROM potential_duplicates pd
      WHERE pd.status = 'pending'
      ORDER BY pd.overall_similarity DESC
      LIMIT $1
    `, [limit]);
    
    res.json({ duplicates: duplicates.rows });
  } catch (error) {
    logger.error('Failed to get duplicates', error);
    res.status(500).json({ error: 'Failed to get duplicates' });
  }
});

export default router;

