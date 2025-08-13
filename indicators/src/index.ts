// packages/render-indicators/src/index.ts
import * as dotenv from 'dotenv';
const express = require('express');
import { IndicatorService } from './services/IndicatorService';
import { DatabaseService } from './services/DatabaseService';
import { SignalGenerator } from './services/SignalGenerator';
import { TokenManager } from './services/TokenManager';

// Load environment variables
dotenv.config();

class IndicatorUpdaterApp {
  private indicatorService: IndicatorService;
  private databaseService: DatabaseService;
  private signalGenerator: SignalGenerator;
  private tokenManager: TokenManager;
  private updateInterval: number;
  private isRunning: boolean = false;
  private app: any;
  private port: number;

  constructor() {
    this.updateInterval = parseInt(process.env.UPDATE_INTERVAL_MS || '60000', 10);
    this.port = parseInt(process.env.PORT || '10000', 10);
    this.app = express(); // Initialize app here
    this.databaseService = new DatabaseService();
    this.signalGenerator = new SignalGenerator();
    this.tokenManager = new TokenManager(this.databaseService);
    this.indicatorService = new IndicatorService(
      this.databaseService,
      this.signalGenerator,
      this.tokenManager
    );
    this.setupHealthEndpoint();
  }

  private setupHealthEndpoint(): void {
    this.app.get('/health', (req: any, res: any) => {
      res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        service: 'position-keeper-indicators',
        isRunning: this.isRunning
      });
    });

    this.app.get('/', (req: any, res: any) => {
      res.json({
        service: 'Position Keeper Indicators',
        status: this.isRunning ? 'running' : 'stopped',
        version: '1.0.0',
        updateInterval: this.updateInterval
      });
    });
  }

  async initialize(): Promise<void> {
    console.log('🚀 Initializing Solana Trading Indicator Service...');
    console.log(`📊 Update interval: ${this.updateInterval}ms`);
    console.log(`🌐 Health server will run on port: ${this.port}`);
    
    try {
      // Initialize database connection
      await this.databaseService.initialize();
      console.log('✅ Database connection established');

      // Load initial token configuration
      await this.tokenManager.loadTokens();
      console.log('✅ Token configuration loaded');

      // Validate environment and configuration
      await this.validateConfiguration();
      console.log('✅ Configuration validated');

    } catch (error) {
      console.error('❌ Initialization failed:', error);
      process.exit(1);
    }
  }

  async validateConfiguration(): Promise<void> {
    const required = [
      'CLOUDFLARE_D1_DATABASE_URL',
      'CLOUDFLARE_D1_TOKEN',
      'QUICKNODE_URL'
    ];

    for (const key of required) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
      }
    }

    // Test database connection
    const activeTokens = await this.tokenManager.getActiveTokens();
    if (activeTokens.length === 0) {
      console.warn('⚠️  No active tokens configured');
    } else {
      console.log(`📈 Monitoring ${activeTokens.length} active tokens: ${activeTokens.map(t => t.symbol).join(', ')}`);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('⚠️  Service already running');
      return;
    }

    // Start HTTP server for health checks
    this.app.listen(this.port, () => {
      console.log(`🌐 Health check server running on port ${this.port}`);
    });

    this.isRunning = true;
    console.log('🔥 Starting indicator update loop...');

    // Initial update
    await this.runUpdateCycle();

    // Schedule regular updates
    const intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.runUpdateCycle();
      } else {
        clearInterval(intervalId);
      }
    }, this.updateInterval);

    // Graceful shutdown handling
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async runUpdateCycle(): Promise<void> {
    const startTime = Date.now();
    console.log(`\n🔄 [${new Date().toISOString()}] Starting update cycle...`);

    try {
      const result = await this.indicatorService.updateAllTokens();
      const duration = Date.now() - startTime;
      
      console.log(`✅ Update cycle completed in ${duration}ms`);
      console.log(`📊 Processed: ${result.processed} tokens`);
      console.log(`📈 Signals: ${result.signals.BUY} BUY, ${result.signals.SELL} SELL, ${result.signals.NONE} NONE`);
      console.log(`❌ Failed: ${result.failed} tokens`);

      if (result.errors.length > 0) {
        console.warn('⚠️  Errors encountered:');
        result.errors.forEach(error => console.warn(`   - ${error}`));
      }

    } catch (error) {
      console.error('❌ Update cycle failed:', error);
      
      // Don't exit on errors, just log and continue
      console.log('🔄 Continuing with next cycle...');
    }
  }

  async shutdown(): Promise<void> {
    console.log('\n🛑 Shutting down gracefully...');
    this.isRunning = false;

    try {
      await this.databaseService.close();
      console.log('✅ Database connections closed');
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
    }

    console.log('👋 Service stopped');
    process.exit(0);
  }
}

// Start the application
async function main() {
  const app = new IndicatorUpdaterApp();
  
  try {
    await app.initialize();
    await app.start();
  } catch (error) {
    console.error('💥 Application failed to start:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  main();
}