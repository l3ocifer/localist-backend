import { Pool } from 'pg';
import { EventEmitter } from 'events';
import { BaseAgent } from './base.agent';
import { EaterHunter } from './eater-hunter.agent';
import { InfatuationHunter } from './infatuation-hunter.agent';
import { ThrillistHunter } from './thrillist-hunter.agent';
import { DeduplicationAgent, ScoringAgent } from './archivist.agent';
import { CityListCurator, CurationAlgorithm } from './curator.agent';
import logger from '../services/logger.service';

export interface AgentSchedule {
  agentName: string;
  cronExpression: string;
  enabled: boolean;
}

export interface AgentEvent {
  type: 'bronze.inserted' | 'silver.updated' | 'gold.published';
  data: any;
  timestamp: Date;
}

/**
 * Agent Coordinator - Manages all agents and their coordination
 * 
 * Responsibilities:
 * - Initialize and register agents
 * - Schedule agent execution
 * - Coordinate event-driven processing
 * - Monitor agent health
 * - Handle agent failures and retries
 */
export class AgentCoordinator extends EventEmitter {
  private db: Pool;
  private agents: Map<string, BaseAgent>;
  private schedules: Map<string, NodeJS.Timeout>;
  private running: boolean = false;

  constructor(db: Pool) {
    super();
    this.db = db;
    this.agents = new Map();
    this.schedules = new Map();
  }

  /**
   * Initialize the coordinator and all agents
   */
  async initialize(): Promise<void> {
    logger.info('Initializing Agent Coordinator');

    // Register Hunter Agents
    await this.registerAgent(new EaterHunter(this.db));
    await this.registerAgent(new InfatuationHunter(this.db));
    await this.registerAgent(new ThrillistHunter(this.db));
    
    // Register Archivist Agents
    await this.registerAgent(new DeduplicationAgent(this.db));
    await this.registerAgent(new ScoringAgent(this.db));

    // Register Curator Agents (examples)
    const defaultAlgorithm: CurationAlgorithm = {
      id: 'default_v1',
      name: 'Default Curation Algorithm v1',
      version: '1.0',
      expertWeight: 0.70,
      consumerWeight: 0.30,
      recencyWeight: 0.20,
      sourceWeights: {
        'eater_38': 0.90,
        'michelin': 0.95,
        'yelp': 0.30,
        'google': 0.35
      },
      minSourceCount: 2,
      minConfidenceScore: 0.70,
      boostFactors: {
        'michelin_three_star': 20,
        'michelin_two_star': 15,
        'michelin_one_star': 10,
        'james_beard_winner': 10,
        'new_opening': 5
      }
    };

    const cities = ['nyc', 'la', 'chicago', 'miami', 'vegas'];
    const categories = ['Restaurant', 'Bar', 'Cafe', 'Nightclub'];

    for (const city of cities) {
      await this.registerAgent(
        new CityListCurator(this.db, city, categories, defaultAlgorithm)
      );
    }

    // Setup event listeners
    this.setupEventListeners();

    logger.info(`Agent Coordinator initialized with ${this.agents.size} agents`);
  }

  /**
   * Register an agent
   */
  private async registerAgent(agent: BaseAgent): Promise<void> {
    await agent.initialize();
    const info = agent.getInfo();
    this.agents.set(info.name, agent);
    logger.info(`Registered agent: ${info.name} (${info.type})`);
  }

  /**
   * Setup event-driven coordination
   */
  private setupEventListeners(): void {
    // When bronze data inserted, trigger archivists
    this.on('bronze.inserted', async () => {
      logger.info('Bronze data inserted, triggering archivists');
      await this.runAgent('DeduplicationAgent');
    });

    // When silver data updated, trigger curators
    this.on('silver.updated', async (eventData: { cityId?: string }) => {
      logger.info('Silver data updated, triggering curators');
      // Trigger relevant city curators
      if (eventData.cityId) {
        await this.runAgent(`CityListCurator-${eventData.cityId}`);
      }
    });

    // When gold list published, clear caches
    this.on('gold.published', async () => {
      logger.info('Gold list published, clearing caches');
      // TODO: Integrate with cache service
    });
  }

  /**
   * Start the coordinator with scheduled jobs
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Agent Coordinator is already running');
      return;
    }

    this.running = true;
    logger.info('Starting Agent Coordinator');

    // Setup schedules
    const schedules: AgentSchedule[] = [
      // Hunters
      { agentName: 'EaterHunter', cronExpression: '0 2 * * *', enabled: true },
      { agentName: 'InfatuationHunter', cronExpression: '0 2 * * *', enabled: true },
      { agentName: 'ThrillistHunter', cronExpression: '0 2 * * *', enabled: true },
      
      // Archivists
      { agentName: 'DeduplicationAgent', cronExpression: '0 4 * * *', enabled: true },
      { agentName: 'ScoringAgent', cronExpression: '0 5 * * *', enabled: true },
      
      // Curators (run for all cities)
      { agentName: 'CityListCurator-nyc', cronExpression: '0 7 * * *', enabled: true },
      { agentName: 'CityListCurator-la', cronExpression: '0 7 * * *', enabled: true },
      { agentName: 'CityListCurator-chicago', cronExpression: '0 7 * * *', enabled: true },
      { agentName: 'CityListCurator-miami', cronExpression: '0 7 * * *', enabled: true },
      { agentName: 'CityListCurator-vegas', cronExpression: '0 7 * * *', enabled: true }
    ];

    for (const schedule of schedules) {
      if (schedule.enabled) {
        this.scheduleAgent(schedule.agentName, schedule.cronExpression);
      }
    }

    logger.info('Agent Coordinator started with scheduled jobs');
  }

  /**
   * Schedule an agent to run on a cron expression
   * Note: For production, use node-cron or bull queue
   */
  private scheduleAgent(agentName: string, cronExpression: string): void {
    // Simple interval-based scheduling (replace with proper cron in production)
    const intervalMs = this.cronToInterval(cronExpression);
    
    const timeout = setInterval(async () => {
      try {
        await this.runAgent(agentName);
      } catch (error) {
        logger.error(`Scheduled run failed for ${agentName}`, error);
      }
    }, intervalMs);

    this.schedules.set(agentName, timeout);
    logger.info(`Scheduled ${agentName} with expression: ${cronExpression}`);
  }

  /**
   * Convert cron expression to interval (simplified)
   * In production, use a proper cron library like node-cron
   */
  private cronToInterval(cronExpression: string): number {
    // Simplified: '0 2 * * *' = daily = 24 hours
    // For MVP, use fixed intervals
    if (cronExpression.includes('* * * * *')) return 60 * 1000; // Every minute
    if (cronExpression.includes('0 * * * *')) return 60 * 60 * 1000; // Hourly
    return 24 * 60 * 60 * 1000; // Daily
  }

  /**
   * Run a specific agent by name
   */
  async runAgent(agentName: string): Promise<void> {
    const agent = this.agents.get(agentName);
    
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }

    logger.info(`Running agent: ${agentName}`);
    
    try {
      await agent.run();
      logger.info(`Agent completed successfully: ${agentName}`);
    } catch (error) {
      logger.error(`Agent failed: ${agentName}`, error);
      throw error;
    }
  }

  /**
   * Run all agents of a specific type
   */
  async runAgentsByType(type: 'hunter' | 'archivist' | 'curator'): Promise<void> {
    logger.info(`Running all ${type} agents`);
    
    const agentsOfType = Array.from(this.agents.values())
      .filter(agent => agent.getInfo().type === type);

    for (const agent of agentsOfType) {
      try {
        await agent.run();
      } catch (error) {
        logger.error(`Agent ${agent.getInfo().name} failed`, error);
        // Continue with other agents
      }
    }

    logger.info(`Completed running ${agentsOfType.length} ${type} agents`);
  }

  /**
   * Run full pipeline: hunters -> archivists -> curators
   */
  async runFullPipeline(): Promise<void> {
    logger.info('Starting full pipeline execution');

    try {
      // Phase 1: Hunters collect data
      logger.info('Phase 1: Running hunters');
      await this.runAgentsByType('hunter');
      
      // Phase 2: Archivists organize data
      logger.info('Phase 2: Running archivists');
      await this.runAgentsByType('archivist');
      
      // Phase 3: Curators create lists
      logger.info('Phase 3: Running curators');
      await this.runAgentsByType('curator');
      
      logger.info('Full pipeline execution completed successfully');
    } catch (error) {
      logger.error('Full pipeline execution failed', error);
      throw error;
    }
  }

  /**
   * Get status of all agents
   */
  async getAgentsStatus(): Promise<any[]> {
    const statuses = [];

    for (const [name, agent] of this.agents.entries()) {
      const info = agent.getInfo();
      
      // Get last run info from database
      const lastRun = await this.db.query(
        `SELECT status, started_at, completed_at, records_processed
         FROM agent_runs
         WHERE agent_id = $1
         ORDER BY started_at DESC
         LIMIT 1`,
        [info.id]
      );

      statuses.push({
        name,
        type: info.type,
        status: info.status,
        lastRun: lastRun.rows[0] || null
      });
    }

    return statuses;
  }

  /**
   * Get agent run history
   */
  async getAgentRunHistory(agentName: string, limit: number = 10): Promise<any[]> {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }

    const result = await this.db.query(
      `SELECT 
         id, status, records_processed, records_created,
         records_updated, records_failed, error_message,
         metadata, started_at, completed_at
       FROM agent_runs
       WHERE agent_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [agent.getInfo().id, limit]
    );

    return result.rows;
  }

  /**
   * Pause an agent
   */
  async pauseAgent(agentName: string): Promise<void> {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }

    await agent.pause();
    
    // Cancel scheduled job
    const schedule = this.schedules.get(agentName);
    if (schedule) {
      clearInterval(schedule);
      this.schedules.delete(agentName);
    }

    logger.info(`Paused agent: ${agentName}`);
  }

  /**
   * Resume an agent
   */
  async resumeAgent(agentName: string, cronExpression?: string): Promise<void> {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }

    await agent.resume();
    
    // Reschedule if cron provided
    if (cronExpression) {
      this.scheduleAgent(agentName, cronExpression);
    }

    logger.info(`Resumed agent: ${agentName}`);
  }

  /**
   * Stop the coordinator
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    logger.info('Stopping Agent Coordinator');

    // Clear all scheduled jobs
    for (const [name, schedule] of this.schedules.entries()) {
      clearInterval(schedule);
      logger.info(`Cleared schedule for ${name}`);
    }

    this.schedules.clear();
    this.running = false;

    logger.info('Agent Coordinator stopped');
  }

  /**
   * Get coordinator status
   */
  getStatus() {
    return {
      running: this.running,
      agentCount: this.agents.size,
      scheduledJobs: this.schedules.size,
      agents: Array.from(this.agents.values()).map(a => a.getInfo())
    };
  }
}

// Singleton instance
let coordinatorInstance: AgentCoordinator | null = null;

export function getAgentCoordinator(db: Pool): AgentCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new AgentCoordinator(db);
  }
  return coordinatorInstance;
}
