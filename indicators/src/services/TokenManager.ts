// src/services/TokenManager.ts
import { TokenConfig, ConfigFile } from '../types/shared';
import { DatabaseService } from './DatabaseService';

export class TokenManager {
  private tokens: TokenConfig[] = [];
  private config: ConfigFile | null = null;

  constructor(private databaseService: DatabaseService) {}

  async loadTokens(): Promise<void> {
    console.log('[TokenManager] Loading tokens...');
    
    try {
      // Try to load from database first
      const dbTokens = await this.databaseService.getTokens();
      
      if (dbTokens && dbTokens.length > 0) {
        this.tokens = dbTokens;
        console.log(`✅ Loaded ${dbTokens.length} tokens from database`);
        return;
      }

      console.log('[TokenManager] No tokens in database, initializing defaults...');
      
    } catch (error) {
      console.warn('⚠️  Database error when loading tokens:', error);
      console.log('[TokenManager] Falling back to default tokens...');
    }

    // Always initialize defaults if database is empty or fails
    await this.initializeDefaultTokens();
  }

  private async initializeDefaultTokens(): Promise<void> {
    // Real token configuration from your tokens.json
    const defaultTokens: TokenConfig[] = [
      {
        symbol: 'MASK',
        pair: 'GWPLjamb5ZxrGbTsYNWW7V3p1pAMryZSfaPFTdaEsWgC',
        mint: '6MQpbiTC2YcogidTmKqMLK82qvE9z5QEm7EP3AEDpump',
        active: true,
        notes: 'catwifmask - PumpSwap pair'
      },
      {
        symbol: 'BONK',
        pair: '6oFWm7KPLfxnwMb3z5xwBoXNSPP3JJyirAPqPSiVcnsp',
        mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        active: true,
        notes: 'Bonk memecoin'
      },
      {
        symbol: 'WIF',
        pair: 'EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx',
        mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        active: true,
        notes: 'dogwifhat'
      },
      {
        symbol: 'USELESS',
        pair: 'Q2sPHPdUWFMg7M7wwrQKLrn619cAucfRsmhVJffodSp',
        mint: 'Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk',
        active: true,
        notes: 'This coin didn\'t perform'
      },
      {
        symbol: 'PENGU',
        pair: 'B4Vwozy1FGtp8SELXSXydWSzavPUGnJ77DURV2k4MhUV',
        mint: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv',
        active: true,
        notes: 'Pengu on Raydium'
      }
    ];

    this.tokens = defaultTokens;
    console.log('✅ Loaded real token configurations');

    // Try to save to database but don't fail if it doesn't work
    try {
      console.log('[TokenManager] Attempting to save tokens to database...');
      for (const token of defaultTokens) {
        await this.databaseService.saveToken(token);
      }
      console.log('✅ Successfully saved tokens to database');
    } catch (error) {
      console.warn('⚠️  Failed to save tokens to database (continuing with in-memory):', error);
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
    
    // Try to save to database but don't fail if it doesn't work
    try {
      await this.databaseService.saveToken(this.tokens[tokenIndex]);
      console.log(`✅ Updated token ${symbol} in database`);
    } catch (error) {
      console.warn(`⚠️  Failed to save ${symbol} to database (continuing with in-memory):`, error);
    }
    
    return true;
  }

  async addToken(token: TokenConfig): Promise<boolean> {
    // Check if token already exists
    const existing = this.tokens.find(t => t.symbol === token.symbol);
    if (existing) {
      console.warn(`Token ${token.symbol} already exists`);
      return false;
    }

    this.tokens.push(token);
    console.log(`✅ Added new token: ${token.symbol} (in-memory)`);
    return true;
  }

  async removeToken(symbol: string): Promise<boolean> {
    const tokenIndex = this.tokens.findIndex(token => token.symbol === symbol);
    
    if (tokenIndex === -1) {
      return false;
    }

    this.tokens.splice(tokenIndex, 1);
    console.log(`✅ Removed token: ${symbol} (in-memory)`);
    return true;
  }

  getTokenCount(): number {
    return this.tokens.length;
  }

  getActiveTokenCount(): number {
    return this.tokens.filter(token => token.active).length;
  }
}