export const PACKAGE_ID       = '0x3a83cd5071f66289a37ec6eff9de65d9933182effca831c5282e39b709e3a1b4';
export const GAME_CONFIG_ID   = '0x4eba8f6e54de68572ccf114480862e7c1182ce06b4f7464ca72d919f27f9e036';
export const LEADERBOARD_ID   = '0x9fab8a367991144c393209b3ed6568e7be77cb4ce92f52ba592175ba347142b2';
export const ROUND_HISTORY_ID = '0x967a20442fb8eae1df4aaa2a0f31de4df2b479bcc3f84decf9707c549ca2618a';

export const SUPER_ADMIN   = '0xc255fdfec837d4671b6f40e8135ca29875324bb7e494d4262b5555af7b1b1322';
export const ADMIN_ADDRESS = SUPER_ADMIN;

export const GOOGLE_SCRIPT_URL = import.meta.env.VITE_GOOGLE_SCRIPT_URL ?? '';
export const GOOGLE_ADMIN_KEY  = import.meta.env.VITE_GOOGLE_ADMIN_KEY ?? '';

export const WALRUS_AGGREGATOR = '/walrus';

export const NFT_IMAGE_BLOBS: Record<number, string> = {
  1: 'HAtP8kcW6b_nK1_I5wOgBzLtBB1pfd9S5iYqWN5s65E', // easy
  2: 'B9zVLuUFV9xV46p9Ss8Vbneiks7wcXuQxTeGj5NUDt4', // medium
  3: 'M5VU50lJN-bpQRzkzNEvLY4P4rS4Y9V5oCrhyE8ww0Y', // hard
};

export const LOCKED_IMAGE_BLOB = '7xBLwQdwaSHQP5MonEsMtIPy4lnN-cylD1WaIWoxTM4';
export const DIFFICULTY_LABELS: Record<number, string> = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

export const DURATION_MS: Record<number, number> = {
  1: 3 * 60 * 60 * 1000,
  2: 6 * 60 * 60 * 1000,
  3: 9 * 60 * 60 * 1000,
};

export const BLOCK_RANGE_WIDTH: Record<number, number> = {
  1: 30,
  2: 60,
  3: 90,
};

export const DIFFICULTY_POINTS: Record<number, number> = { 1: 1, 2: 2, 3: 3 };

export const SUISCAN_TX_URL    = (digest: string) => `https://suiscan.xyz/mainnet/tx/${digest}`;
export const SUIVISION_TX_URL  = (digest: string) => `https://suivision.xyz/txblock/${digest}`;
export const SUISCAN_BLOCK_URL = (checkpoint: string) => `https://suiscan.xyz/mainnet/checkpoint/${checkpoint}`;
