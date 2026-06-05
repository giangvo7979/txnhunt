# 🎮 TxnHunt

> **Hunt real transactions on the Sui blockchain. Submit the correct digest → Mint your NFT. Fastest wins!**

TxnHunt is a blockchain-based treasure hunt game where players solve on-chain clues to find real Sui transactions, submit the correct digest, and mint exclusive NFTs as rewards.

---

## 🎮 How It Works

1. **Connect** your Sui wallet
2. **Read the clue** — each round gives hints about a real transaction on-chain
3. **Hunt** the correct transaction digest on Sui blockchain
4. **Submit** your answer before time runs out
5. **Mint** an NFT if you're correct — harder rounds = rarer NFTs!

### Difficulty Levels

| Level  | Time Limit | Points | Block Range |
|--------|-----------|--------|-------------|
| Easy   | 3 hour    | 1 pt   | ±30 blocks  |
| Medium | 6 hours   | 2 pts  | ±60 blocks  |
| Hard   | 9 hours   | 3 pts  | ±90 blocks  |

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Blockchain | [Sui](https://sui.io/) (Move smart contracts) |
| RPC Provider | [Tatum](https://tatum.io/) |
| NFT Storage | [Walrus](https://walrus.xyz/) (decentralized blob storage) |
---

## 📁 Project Structure

```
TatumHunt/
├── frontend/               # React + Vite app
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Play.tsx    # Main game page for players
│   │   │   └── Admin.tsx   # Admin panel to manage rounds
│   │   ├── lib/
│   │   │   ├── contract.ts     # Sui smart contract interactions
│   │   │   ├── suiClient.ts
│   │   │   ├── walrus.ts       # Walrus storage integration
│   │   │   ├── tatum.ts        # Tatum API helpers
│   │   │   ├── crypto.ts       # Cryptographic utilities
│   │   │   ├── googleScript.ts
│   │   │   └── constants.ts    # Contract IDs & config
│   │   ├── hooks/
│   │   │   └── useCountdown.ts # Countdown timer hook
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── vercel.json
│   ├── vite.config.ts
│   └── package.json
└── move/                   # Sui Move smart contracts
    ├── sources/
    │   ├── game.move       # Core game logic
    │   └── leaderboard.move
    └── Move.toml

```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A Sui wallet (e.g. Sui Wallet, Suiet)
- [Tatum](https://tatum.io/) API key

### Local Development

```bash
# Clone the repo
git clone https://github.com/giangvo7979/txnhunt.git
cd txnhunt/frontend

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Fill in your keys (see Environment Variables section)

# Start dev server
npm run dev
```

### Environment Variables

Create a `.env` file in the `frontend/` directory:

```env
VITE_TATUM_API_KEY=your_tatum_api_key_here
VITE_GOOGLE_SCRIPT_URL=your_google_apps_script_url_here
VITE_GOOGLE_ADMIN_KEY=your_admin_key_here
```

> ⚠️ **Never commit your `.env` file.** It is listed in `.gitignore`.

---

## 🌐 Deployment (Vercel)

1. Push this repo to GitHub
2. Import the project on [vercel.com](https://vercel.com)
3. Set **Root Directory** to `frontend`
4. Add all environment variables in Vercel Dashboard → Settings → Environment Variables
5. Deploy!

---

## 📜 Smart Contracts (Sui Mainnet)

| Contract | Object ID |
|----------|-----------|
| Package | `0x3a83cd5071f66289a37ec6eff9de65d9933182effca831c5282e39b709e3a1b4` |
| Game Config | `0x4eba8f6e54de68572ccf114480862e7c1182ce06b4f7464ca72d919f27f9e036` |
| Leaderboard | `0x9fab8a367991144c393209b3ed6568e7be77cb4ce92f52ba592175ba347142b2` |
| Round History | `0x967a20442fb8eae1df4aaa2a0f31de4df2b479bcc3f84decf9707c549ca2618a` |

---

## 🔗 Useful Links

- [Sui Explorer](https://suiscan.xyz/mainnet)
- [SuiVision](https://suivision.xyz)
- [Walrus Aggregator](https://aggregator.walrus-mainnet.walrus.space/v1)

---

## 📄 License

MIT
