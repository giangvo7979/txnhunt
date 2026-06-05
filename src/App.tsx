import { ConnectButton, useCurrentAccount } from '@mysten/dapp-kit';
import { useState, useEffect } from 'react';
import { SUPER_ADMIN } from './lib/constants';
import { fetchAdminList } from './lib/contract';
import Admin from './pages/Admin';
import Play from './pages/Play';

export default function App() {
  const account = useCurrentAccount();
  const [adminList, setAdminList] = useState<string[]>([]);

  useEffect(() => {
    fetchAdminList().then(setAdminList);
  }, []);

  const isSuperAdmin = account?.address.toLowerCase() === SUPER_ADMIN.toLowerCase();
  const isAdmin = isSuperAdmin || adminList.some(
    addr => addr.toLowerCase() === account?.address.toLowerCase()
  );

  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-brand">
          <img src="/walrus/blobs/Wdphiq28_eIy6CsnJ8BLFca0jXXwLdpB6Pu7ecgqRbk" alt="TxnHunt" className="brand-icon" />
          <span className="brand-name">TxnHunt</span>
        </div>
        <div className="nav-right">
          {account && isAdmin && <span className="admin-indicator">⚡ ADMIN</span>}
          <ConnectButton />
        </div>
      </nav>

      <main className="main-content">
        {!account ? (
          <div className="connect-screen">
            <div className="connect-hero">
              <img src="/walrus/blobs/Wdphiq28_eIy6CsnJ8BLFca0jXXwLdpB6Pu7ecgqRbk" alt="TxnHunt" className="hero-glyph" />
              <h1 className="hero-title">
                Find the Transaction.<br />
                <span className="hero-accent">Claim the NFT.</span>
              </h1>
              <p className="hero-desc">
                Hunt real transactions on the Sui blockchain using on-chain clues.<br />
                Submit the correct digest → Mint your NFT. Fastest wins!
              </p>
              <div className="connect-cta">
              </div>
              <div className="hero-features">
                <div className="feature">
                  <span className="feature-icon">🎯</span>
                  <span>3 Difficulty Levels</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">🐋</span>
                  <span>Walrus Storage</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">⚡</span>
                  <span>Tatum RPC</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">🏆</span>
                  <span>On-chain Leaderboard</span>
                </div>
              </div>
            </div>
          </div>
        ) : isAdmin ? (
          <Admin
            isSuperAdmin={isSuperAdmin}
            adminList={adminList}
            onAdminChange={() => fetchAdminList().then(setAdminList)}
          />
        ) : (
          <Play />
        )}
      </main>
    </div>
  );
}