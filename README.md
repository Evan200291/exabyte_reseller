# Telegram Auto-Delivery Reseller Bot

A Node.js Telegram bot for reselling digital products with automatic delivery, multiple payment methods, and an admin web panel.

## Features

- **Telegram Customer Bot**: Browse products by category, search, view details, and purchase
- **Telegram Payment Bot**: Handle top-ups with screenshot verification
- **Admin Web Panel**: Manage products, users, orders, payments, and settings
- **Multi-Provider Support**: G2Bulk, Raccoon API, TunVN (extensible)
- **Automatic Stock Sync**: Periodic synchronization with provider APIs
- **PDF Price List**: Generate downloadable product catalogs
- **User API Keys**: Allow programmatic access for resellers

## Requirements

- Node.js 18+
- Telegram Bot tokens (create via [@BotFather](https://t.me/BotFather))

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd reseller-bot
   ```

2. Copy the environment template and configure:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your credentials:
   - `CUSTOMER_BOT_TOKEN` - Telegram bot token for customer interactions
   - `PAYMENT_BOT_TOKEN` - Telegram bot token for payment/admin functions
   - `ADMIN_TELEGRAM_IDS` - Comma-separated Telegram user IDs for admins
   - `ADMIN_PASSWORD` - Password for the web admin panel
   - Provider API keys (G2BULK_API_KEY, RACCOON_API_KEY, etc.)

4. Start the bot:
   ```bash
   npm start
   ```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CUSTOMER_BOT_TOKEN` | Telegram bot token for customers | - |
| `PAYMENT_BOT_TOKEN` | Telegram bot token for payments/admin | - |
| `ADMIN_TELEGRAM_IDS` | Admin Telegram IDs (comma-separated) | - |
| `ADMIN_HOST` | Admin panel bind address | 127.0.0.1 |
| `ADMIN_PORT` | Admin panel port | 3000 |
| `ADMIN_PASSWORD` | Admin panel password | - |
| `STORE_NAME` | Display name for the store | Auto Delivery Store |
| `CONTACT_TEXT` | Support contact message | - |
| `DEFAULT_REVENUE_PERCENT` | Markup percentage on products | 5 |
| `USDT_TO_MMK` | USDT to MMK exchange rate | 4000 |
| `STOCK_SYNC_SECONDS` | Stock sync interval | 45 |
| `PAYMENT_METHODS` | Payment options (format below) | - |

### Payment Methods Format

```
KBZ Pay|09xxxxxxxxx|Account Name;Wave Pay|09xxxxxxxxx|Account Name
```

## Project Structure

```
├── src/
│   ├── index.js        # Entry point
│   ├── config.js       # Configuration loader
│   ├── store.js        # Data persistence layer
│   ├── telegram.js     # Telegram bot handlers
│   ├── admin.js        # Admin web panel
│   ├── pdf.js          # PDF generation
│   ├── logger.js       # Logging utility
│   └── providers/      # API provider modules
│       ├── base.js     # Base provider class
│       ├── index.js    # Provider registry
│       ├── g2bulk.js   # G2Bulk API
│       ├── raccoon.js  # Raccoon API
│       └── tunvn.js    # TunVN API
├── data/               # Persistent data (gitignored)
├── logs/               # Log files (gitignored)
└── .env                # Configuration (gitignored)
```

## Admin Panel

Access the admin panel at `http://localhost:3000` (or configured host/port).

Features:
- Dashboard with sales statistics
- Product management with notes
- User management (balance, blocking)
- Order history and fulfillment
- Payment approval/rejection
- Settings configuration
- API error logs

## Bot Commands

### Customer Bot
- `/start` or `/menu` - Main menu
- `/search <query>` - Search products
- `/account` - View account balance
- `/pay` - Top up balance
- `/pricelist` - Download PDF catalog
- `/apikey` - Generate API key
- `/apidocs` - View API documentation

### Payment Bot (Admin)
- `/broadcast <message>` - Send message to all users
- Payment screenshot review and approval

## API Endpoints

The admin panel exposes a REST API:

- `GET /api/store` - Store information
- `GET /api/products` - List products
- `GET /api/products/:id` - Product details
- `GET /api/settings` - Store settings
- `GET /api/payments` - Payment history
- `GET /api/orders` - Order history

Use header `X-API-Key: <your-key>` for authentication.

## Adding New Providers

1. Create a new file in `src/providers/`
2. Extend the `Provider` base class
3. Implement `syncProducts()` and `buy()` methods
4. Register in `src/providers/index.js`
5. Add configuration to `src/config.js`

## License

Private - All rights reserved.
