module txnhunt::leaderboard {
    use std::vector;
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::clock::{Self, Clock};
    use sui::event;

    public struct GameWitness has drop {}
    public(package) fun new_game_witness(): GameWitness { GameWitness {} }

    public struct LeaderboardAdminCap has key, store {
        id: UID,
    }

    fun init(ctx: &mut TxContext) {
        transfer::transfer(
            LeaderboardAdminCap { id: object::new(ctx) },
            tx_context::sender(ctx),
        );
    }

    public struct ScoreEntry has store, copy, drop {
        wallet:    address,
        points:    u64,
        nft_count: u64,
        last_mint: u64,
    }

    public struct MonthlyBoard has store, drop {
        year_month: u64,
        entries:    vector<ScoreEntry>,
    }

    public struct Leaderboard has key {
        id:       UID,
        monthly:  vector<MonthlyBoard>,
        all_time: vector<ScoreEntry>,
    }

    public struct ScoreAdded has copy, drop {
        wallet:     address,
        points:     u64,
        year_month: u64,
    }

    public entry fun create_and_share(ctx: &mut TxContext) {
        transfer::share_object(Leaderboard {
            id:       object::new(ctx),
            monthly:  vector[],
            all_time: vector[],
        });
    }

    public fun add_score(
        lb:      &mut Leaderboard,
        _w:      GameWitness,
        wallet:  address,
        points:  u64,
        clock:   &Clock,
        _ctx:    &mut TxContext,
    ) {
        let now        = clock::timestamp_ms(clock);
        let year_month = timestamp_to_year_month(now);
        let month_idx  = find_or_create_month(&mut lb.monthly, year_month);
        let board      = vector::borrow_mut(&mut lb.monthly, month_idx);
        upsert_entry(&mut board.entries, wallet, points, now);
        upsert_entry(&mut lb.all_time, wallet, points, now);
        event::emit(ScoreAdded { wallet, points, year_month });
    }

    public fun get_all_time_scores(lb: &Leaderboard): vector<ScoreEntry> { sorted_copy(&lb.all_time) }

    public entry fun reset(
        _cap: &LeaderboardAdminCap,
        lb:   &mut Leaderboard,
    ) {
        lb.monthly  = vector[];
        lb.all_time = vector[];
    }
    public fun entry_wallet(e: &ScoreEntry): address { e.wallet }
    public fun entry_points(e: &ScoreEntry): u64     { e.points }
    public fun entry_nft_count(e: &ScoreEntry): u64  { e.nft_count }
    public fun entry_last_mint(e: &ScoreEntry): u64  { e.last_mint }

    fun timestamp_to_year_month(ts_ms: u64): u64 {
        let days      = ts_ms / 86_400_000;
        let year      = 1970 + days / 365;
        let day_of_yr = days % 365;
        let mut month = (day_of_yr * 12 / 365) + 1;
        if (month > 12) { month = 12 };
        year * 100 + month
    }

    fun find_or_create_month(monthly: &mut vector<MonthlyBoard>, year_month: u64): u64 {
        let mut i = 0u64;
        let len = vector::length(monthly);
        while (i < len) {
            if (vector::borrow(monthly, i).year_month == year_month) return i;
            i = i + 1;
        };
        vector::push_back(monthly, MonthlyBoard { year_month, entries: vector[] });
        vector::length(monthly) - 1
    }

    fun upsert_entry(entries: &mut vector<ScoreEntry>, wallet: address, points: u64, last_mint: u64) {
        let mut i = 0u64;
        let len = vector::length(entries);
        while (i < len) {
            let e = vector::borrow_mut(entries, i);
            if (e.wallet == wallet) {
                e.points    = e.points + points;
                e.nft_count = e.nft_count + 1;
                e.last_mint = last_mint;
                return
            };
            i = i + 1;
        };
        vector::push_back(entries, ScoreEntry { wallet, points, nft_count: 1, last_mint });
    }

    fun sorted_copy(entries: &vector<ScoreEntry>): vector<ScoreEntry> {
        let mut result = *entries;
        let len = vector::length(&result);
        if (len <= 1) return result;
        let mut i = 1u64;
        while (i < len) {
            let mut j = i;
            while (j > 0) {
                let prev = *vector::borrow(&result, j - 1);
                let curr = *vector::borrow(&result, j);
                if (should_swap(&prev, &curr)) {
                    vector::swap(&mut result, j - 1, j);
                    j = j - 1;
                } else break
            };
            i = i + 1;
        };
        result
    }

    fun should_swap(a: &ScoreEntry, b: &ScoreEntry): bool {
        if (a.points    != b.points)    return a.points    < b.points;
        if (a.nft_count != b.nft_count) return a.nft_count < b.nft_count;
        a.last_mint > b.last_mint
    }
}
