# Position Keeper - Indicators Service

Continuous Solana token data collection and signal generation service.

## 🎯 Purpose

This service continuously:
- Collects real-time price data from DexScreener
- Calculates technical indicators (RSI, EMA, etc.)
- Generates trend signals using mathematical pattern analysis
- Stores data in Cloudflare D1 database
- Provides health check endpoints for monitoring

## 🏗️ Architecture

```
src/
├── index.ts              # Main application entry point
└── services/
    ├── IndicatorService.ts   # Core indicator calculations
    ├── DatabaseService.ts    # Cloudflare D1 integration
    ├── SignalGenerator.ts    # Trend signal generation
    └── TokenManager.ts       # Token configuration management
```

## 🚀 Deployment

### Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your configuration

# Development mode
npm run dev

# Build and run
npm run build
npm start
```

### Render Deployment

1. **Connect Repository**: Link your GitHub repo to Render
2. **Configure Service**: 
   - Service Type: Web Service
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Health Check: `/health`
3. **Set Environment Variables**:
   - `CLOUDFLARE_D1_DATABASE_URL`
   - `CLOUDFLARE_D1_TOKEN`
   - `QUICKNODE_URL`
4. **Deploy**: Automatic deployment from main branch

## 📊 Endpoints

- `GET /health` - Service health check
- `GET /` - Service status and info

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | 10000 |
| `UPDATE_INTERVAL_MS` | Update frequency | 60000 |
| `CLOUDFLARE_D1_DATABASE_URL` | Database endpoint | Required |
| `CLOUDFLARE_D1_TOKEN` | API token | Required |
| `QUICKNODE_URL` | Solana RPC endpoint | Required |

### Signal Generation

| Variable | Description | Default |
|----------|-------------|---------|
| `MIN_VERTEX_AGE` | Min pattern age (minutes) | 20 |
| `MAX_VERTEX_AGE` | Max pattern age (minutes) | 120 |
| `SIGNAL_EXPIRY_MINUTES` | Signal validity period | 15 |
| `STABILITY_BUFFER` | Confirmation cycles needed | 3 |

## 📈 Monitoring

The service provides health endpoints for monitoring:

```bash
# Health check
curl https://your-service.onrender.com/health

# Service status  
curl https://your-service.onrender.com/
```

## 🐛 Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify Cloudflare D1 credentials
   - Check database URL format
   - Ensure API token has D1 permissions

2. **RPC Errors**
   - Verify QuickNode endpoint URL
   - Check RPC rate limits
   - Confirm endpoint supports required methods

3. **Memory Issues**
   - Monitor data accumulation
   - Check for memory leaks in update cycles
   - Consider upgrading Render plan

### Logs

Check Render dashboard logs for detailed error information:
- Build logs for compilation issues
- Runtime logs for service errors
- Health check logs for connectivity issues