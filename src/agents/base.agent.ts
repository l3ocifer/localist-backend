import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import logger from '../services/logger.service';

export type AgentType = 'hunter' | 'archivist' | 'curator';
export type AgentStatus = 'idle' | 'running' | 'paused' | 'error';
export type AgentRunStatus = 'started' | 'running' | 'completed' | 'failed';

export interface AgentConfig {
  [key: string]: any;
}

export interface AgentRunMetrics {
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  metadata?: Record<string, any>;
}

export abstract class BaseAgent {
  protected id: string;
  protected name: string;
  protected type: AgentType;
  protected config: AgentConfig;
  protected status: AgentStatus = 'idle';
  protected currentRunId?: string;
  protected db: Pool;

  constructor(name: string, type: AgentType, config: AgentConfig, db: Pool) {
    this.name = name;
    this.type = type;
    this.config = config;
    this.db = db;
    this.id = uuidv4();
  }

  /**
   * Initialize the agent (load from DB if exists, create if not)
   */
  async initialize(): Promise<void> {
    const result = await this.db.query(
      `INSERT INTO agents (name, type, config, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT agents_name_type_unique 
       DO UPDATE SET config = $3, updated_at = NOW()
       RETURNING id`,
      [this.name, this.type, this.config, this.status]
    );
    this.id = result.rows[0].id;
    logger.info(`Agent initialized: ${this.name} (${this.type}) - ID: ${this.id}`);
  }

  /**
   * Start a new agent run
   */
  protected async startRun(): Promise<string> {
    const result = await this.db.query(
      `INSERT INTO agent_runs (agent_id, status, started_at)
       VALUES ($1, 'started', NOW())
       RETURNING id`,
      [this.id]
    );
    
    const runId = result.rows[0].id;
    this.currentRunId = runId;
    this.status = 'running';
    
    await this.updateAgentStatus('running');
    
    logger.info(`Agent run started: ${this.name} - Run ID: ${runId}`);
    return runId;
  }

  /**
   * Complete the current agent run
   */
  protected async completeRun(metrics: AgentRunMetrics, error?: Error): Promise<void> {
    if (!this.currentRunId) {
      throw new Error('No active run to complete');
    }

    const status: AgentRunStatus = error ? 'failed' : 'completed';
    
    await this.db.query(
      `UPDATE agent_runs 
       SET status = $1,
           records_processed = $2,
           records_created = $3,
           records_updated = $4,
           records_failed = $5,
           metadata = $6,
           error_message = $7,
           completed_at = NOW()
       WHERE id = $8`,
      [
        status,
        metrics.recordsProcessed,
        metrics.recordsCreated,
        metrics.recordsUpdated,
        metrics.recordsFailed,
        metrics.metadata || {},
        error?.message || null,
        this.currentRunId
      ]
    );

    this.status = error ? 'error' : 'idle';
    await this.updateAgentStatus(this.status);
    await this.updateLastRun();

    const logMessage = error
      ? `Agent run failed: ${this.name} - ${error.message}`
      : `Agent run completed: ${this.name} - Processed: ${metrics.recordsProcessed}`;
    
    error ? logger.error(logMessage) : logger.info(logMessage);
    
    this.currentRunId = undefined;
  }

  /**
   * Update agent status in database
   */
  protected async updateAgentStatus(status: AgentStatus): Promise<void> {
    await this.db.query(
      `UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, this.id]
    );
  }

  /**
   * Update last run timestamp
   */
  protected async updateLastRun(): Promise<void> {
    await this.db.query(
      `UPDATE agents SET last_run_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [this.id]
    );
  }

  /**
   * Execute within a transaction
   */
  protected async withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Main execution method - must be implemented by subclasses
   */
  abstract execute(): Promise<void>;

  /**
   * Validation method - can be overridden by subclasses
   */
  protected async validate(): Promise<boolean> {
    return true;
  }

  /**
   * Run the agent with full lifecycle management
   */
  async run(): Promise<void> {
    if (this.status === 'running') {
      logger.warn(`Agent ${this.name} is already running`);
      return;
    }

    try {
      // Validate before running
      const isValid = await this.validate();
      if (!isValid) {
        throw new Error('Agent validation failed');
      }

      // Start run tracking
      await this.startRun();

      // Execute main logic
      await this.execute();

      // Complete successfully
      await this.completeRun({
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        recordsFailed: 0
      });

    } catch (error) {
      logger.error(`Agent ${this.name} encountered an error:`, error);
      
      if (this.currentRunId) {
        await this.completeRun(
          {
            recordsProcessed: 0,
            recordsCreated: 0,
            recordsUpdated: 0,
            recordsFailed: 0
          },
          error as Error
        );
      }
      
      throw error;
    }
  }

  /**
   * Pause the agent
   */
  async pause(): Promise<void> {
    this.status = 'paused';
    await this.updateAgentStatus('paused');
    logger.info(`Agent paused: ${this.name}`);
  }

  /**
   * Resume the agent
   */
  async resume(): Promise<void> {
    this.status = 'idle';
    await this.updateAgentStatus('idle');
    logger.info(`Agent resumed: ${this.name}`);
  }

  /**
   * Get agent status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Get agent info
   */
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      status: this.status,
      config: this.config
    };
  }
}

