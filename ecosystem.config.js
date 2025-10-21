module.exports = {
  apps: [{
    name: 'discoverlocal-backend',
    script: './dist/index.js',
    instances: process.env.INSTANCES || 'max',
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '1G',
    
    // Environment variables
    env: {
      NODE_ENV: 'development',
      PORT: 3001
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || 3001
    },
    
    // Logging
    error_file: '../logs/error.log',
    out_file: '../logs/output.log',
    log_file: '../logs/combined.log',
    time: true,
    
    // Advanced features
    min_uptime: '10s',
    max_restarts: 10,
    autorestart: true,
    cron_restart: '0 0 * * *', // Restart daily at midnight
    
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 3000,
    
    // Monitoring
    instance_var: 'INSTANCE_ID',
    merge_logs: true,
    
    // Health check
    health_check: {
      interval: 30000,
      url: 'http://localhost:3001/health',
      max_consecutive_failures: 3
    }
  }]
};