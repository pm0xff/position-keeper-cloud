// src/services/TokenManager.ts
import { TokenConfig, ConfigFile } from '../types/shared';
import { DatabaseService } from './DatabaseService';

export class TokenManager {
  private tokens: TokenConfig[] = [];
  private config: ConfigFile | null = null;

  constructor(private databaseService: DatabaseService) {}

  async loadTokens(): Promise<void> {
    try {
      // Try to load from database first
      const dbTokens = await this.databaseService.getTokens();
      
      if (dbTokens && dbTokens.length > 0) {
        this.tokens = dbTokens;
        console.log(`✅ Loaded ${dbTokens.length} tokens from database`);
        return;
      }

      // Fallback to default tokens if database is empty
      await this.initializeDefaultTokens();
      
    } catch (error) {
      console.warn('⚠️  Failed to load tokens from database, using defaults:', error);
      await this.initializeDefaultTokens();
    }
  }

  private async initializeDefaultTokens(): Promise<void> {
    // Default token configuration based on your existing setup
    const defaultTokens: TokenConfig[] = [
      {
        symbol: 'MASK',
        pair: 'BkKRpAUFVZJWRzJhiJWQfJV1B1aVvSPpS48Bz4UXa1ot',
        mint: 'CiKu5d4h5xZp9hCvDn6aqZc8s1VVdS1jW7AJ4FY2Ty4z',
        active: true,
        notes: 'Primary trading token'
      },
      {
        symbol: 'BONK',
        pair: 'FE8HL9QPDN3rqVJ8UCQWyKKBpd8PwcqPCdyQzXwSDUGU',
        mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        active: true,
        notes: 'Secondary trading token'
      },
      {
        symbol: 'WIF',
        pair: 'J2BR7tCHFU7bvmwmtXhwu7sUhDPP8k3JwQH1rz3Fh9vF',
        mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        active: true,
        notes: 'Tertiary trading token'
      },
      {
        symbol: 'VIBE',
        pair: 'EbmZPLrpY3q6J5PzVwMsQK1xXwBZY3pScvPzJNzVzVzV',
        mint: 'G7nZR8cRzR5p8zKoJ3YPzCtPsBKzYfE2LnZMQJrYQMwY',
        active: true,
        notes: 'Test token'
      }
    ];

    this.tokens = defaultTokens;

    // Save to database for future use
    try {
      for (const token of defaultTokens) {
        await this.databaseService.saveToken(token);
      }
      console.log('✅ Initialized default tokens in database');
    } catch (error) {
      console.warn('⚠️  Failed to save default tokens to database:', error);
    }
  }

  async getActiveTokens(): Promise<TokenConfig[]> {
    return this.tokens.filter(token => token.active);
  }

  async getAllTokens(): Promise<TokenConfig[]> {
    return this.tokens;
  }

  async getToken(symbol: string): Promise<TokenConfig | undefined> {
    return this.tokens.find(token => token.symbol === symbol);
  }

  async updateToken(symbol: string, updates: Partial<TokenConfig>): Promise<boolean> {
    const tokenIndex = this.tokens.findIndex(token => token.symbol === symbol);
    
    if (tokenIndex === -1) {
      return false;
    }

    this.tokens[tokenIndex] = { ...this.tokens[tokenIndex], ...updates };

    try {
      await this.databaseService.saveToken(this.tokens[tokenIndex]);
      return true;
    } catch (error) {
      console.error(`Failed to update token ${symbol}:`, error);
      return false;
    }
  }

  async addToken(token: TokenConfig): Promise<boolean> {
    // Check if token already exists
    const existing = this.tokens.find(t => t.symbol === token.symbol);
    if (existing) {
      console.warn(`Token ${token.symbol} already exists`);
      return false;
    }

    this.tokens.push(token);

    try {
      await this.databaseService.saveToken(token);
      console.log(`✅ Added new token: ${token.symbol}`);
      return true;
    } catch (error) {
      console.error(`Failed to add token ${token.symbol}:`, error);
      // Remove from memory if database save failed
      this.tokens = this.tokens.filter(t => t.symbol !== token.symbol);
      return false;
    }
  }

  async removeToken(symbol: string): Promise<boolean> {
    const tokenIndex = this.tokens.findIndex(token => token.symbol === symbol);
    
    if (tokenIndex === -1) {
      return false;
    }

    this.tokens.splice(tokenIndex, 1);

    try {
      await this.databaseService.deleteToken(symbol);
      console.log(`✅ Removed token: ${symbol}`);
      return true;
    } catch (error) {
      console.error(`Failed to remove token ${symbol}:`, error);
      return false;
    }
  }

  getTokenCount(): number {
    return this.tokens.length;
  }

  getActiveTokenCount(): number {
    return this.tokens.filter(token => token.active).length;
  }
}