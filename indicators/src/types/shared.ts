// src/types/shared.ts
// Shared type definitions for the trading system

export interface TrendSignal {
  direction: 'BUY' | 'SELL' | 'NONE';
  confidence: number;
  firstDetected: string;
  lastEvaluated: string;
  expiresAt: string;
  reason: string;
  vertexAge?: number;
  trendStrength?: 'STRONG' | 'MODERATE' | 'WEAK';
  stable?: boolean;
  pattern?: 'U_SHAPED' | 'INVERTED_U';
  magnitude?: number;
}

export interface RoutingInfo {
  tradingCurrency: string;
  nativeCurrency: string;
  isDirect: boolean;
  executionPath: string[];
  confidence: number;
  preferredDEX: string;
  currencyMismatch: boolean;
  lastChecked: string;
}

export interface TokenConfig {
  symbol: string;
  pair: string;
  mint: string;
  active: boolean;
  notes?: string;
  signal?: TrendSignal;
  metadata?: {
    routing?: RoutingInfo;
    [key: string]: any;
  };
}

export interface UpdateResult {
  processed: number;
  failed: number;
  signals: {
    BUY: number;
    SELL: number;
    NONE: number;
  };
  errors: string[];
}

export interface IndicatorData {
  symbol: string;
  price: number;
  native_price: number;
  native_currency: string;
  trading_currency: string;
  currency_mismatch: number;
  rsi_1m: number;
  rsi_5m: number;
  rsi_15m: number;
  ema_1m: number;
  ema_5m: number;
  ema_15m: number;
  ema_trend: string;
  volume_24h: number;
  market_cap: number;
  volume_to_cap_ratio: number;
  trend_score: number;
  hourly_change_pct: number;
  drawdown_from_peak: number;
  volatility_pct: number;
  decimals: number;
  analysis_mode: string;
  timestamp: Date;
}

export interface SignalData {
  symbol: string;
  direction: string;
  confidence: number;
  reason: string;
  vertex_age?: number;
  trend_strength?: string;
  pattern?: string;
  magnitude?: number;
  stable: number;
  first_detected: number;
  last_evaluated: number;
  expires_at: number;
}

export interface PriceData {
  symbol: string;
  price: number;
  volume: number;
  marketCap: number;
  quoteToken: string;
  timestamp: Date;
}

export interface TradingStrategy {
  id?: number;
  wallet_address: string;
  strategy_name: string;
  strategy_type: 'early_exit' | 'large_cap' | 'trailing_hold';
  parameters: Record<string, any>;
  active: boolean;
  created_at?: number;
}

export interface Trade {
  id?: number;
  wallet_address?: string;
  symbol: string;
  strategy_type: string;
  buy_price: number;
  buy_timestamp: number;
  buy_tx_id?: string;
  entry_signal?: string;
  sell_price?: number;
  sell_timestamp?: number;
  sell_tx_id?: string;
  reason?: string;
  amount_tokens: number;
  pnl_pct?: number;
  peak_pnl_pct?: number;
  drawdown_pct?: number;
  duration_seconds?: number;
  is_backtest: number;
  backtest_id?: string;
}

export interface SystemConfig {
  key: string;
  value: string;
  description?: string;
  updated_at?: number;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
}

// Service interface types
export interface IIndicatorService {
  updateAllTokens(): Promise<UpdateResult>;
}

export interface IDatabaseService {
  initialize(): Promise<void>;
  getTokens(): Promise<TokenConfig[]>;
  saveToken(token: TokenConfig): Promise<void>;
  deleteToken(symbol: string): Promise<void>;
  saveFullIndicators(indicators: IndicatorData): Promise<void>;
  saveSignal(signal: SignalData): Promise<void>;
  getActiveSignals(symbol?: string): Promise<any[]>;
  getLatestIndicators(symbol?: string): Promise<any[]>;
  close(): Promise<void>;
}

export interface ITokenManager {
  getActiveTokens(): Promise<TokenConfig[]>;
  getAllTokens(): Promise<TokenConfig[]>;
  getToken(symbol: string): Promise<TokenConfig | null>;
  addToken(token: TokenConfig): Promise<void>;
  updateToken(symbol: string, updates: Partial<TokenConfig>): Promise<void>;
  removeToken(symbol: string): Promise<void>;
  toggleToken(symbol: string): Promise<void>;
}

// Utility types
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  service?: string;
  metadata?: Record<string, any>;
}

// Configuration types
export interface ServiceConfig {
  database: {
    url: string;
    token: string;
  };
  indicators: {
    updateInterval: number;
    maxHistoryLength: number;
    signalConfig: {
      minVertexAge: number;
      maxVertexAge: number;
      expiryMinutes: number;
      stabilityBuffer: number;
      confidenceThreshold: number;
    };
  };
  api: {
    dexScreenerBaseUrl: string;
    requestTimeout: number;
    retryAttempts: number;
  };
}