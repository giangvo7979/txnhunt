module txnhunt::game {
    use std::string::{Self, String};
    use std::hash;
    use std::option::{Self, Option};
    use std::vector;
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::package;
    use sui::display;
    use sui::table::{Self, Table};

    use txnhunt::leaderboard::{Self, Leaderboard, GameWitness};

    const E_WRONG_DIGEST:       u64 = 2;
    const E_ALREADY_MINTED:     u64 = 3;
    const E_SESSION_EXPIRED:    u64 = 4;
    const E_NOT_IN_ALLOWLIST:   u64 = 5;
    const E_WRONG_SESSION:      u64 = 6;
    const E_ALREADY_SOLVED:     u64 = 7;
    const E_INVALID_DIFFICULTY: u64 = 8;
    const E_NOT_ADMIN:          u64 = 9;
    const E_CANNOT_REMOVE_SUPER: u64 = 10;

    const SUPER_ADMIN: address = @0xc255fdfec837d4671b6f40e8135ca29875324bb7e494d4262b5555af7b1b1322;

    const DIFFICULTY_EASY:   u8 = 1;
    const DIFFICULTY_MEDIUM: u8 = 2;
    const DIFFICULTY_HARD:   u8 = 3;

    const POINTS_EASY:   u64 = 1;
    const POINTS_MEDIUM: u64 = 2;
    const POINTS_HARD:   u64 = 3;

    const WALRUS_BASE: vector<u8> = b"https://aggregator.walrus-mainnet.walrus.space/v1/blobs/";

    public struct GAME has drop {}

    public struct AdminCap has key, store { id: UID }

    public struct GameConfig has key {
        id:              UID,
        session_counter: u64,
        current_session: Option<ID>,
        easy_img_blob:   String,
        medium_img_blob: String,
        hard_img_blob:   String,
        locked_img_blob: String,
        admins:          Table<address, bool>,
    }

    public struct Session has key {
        id:             UID,
        session_id:     u64,
        digest_hash:    vector<u8>,
        difficulty:     u8,
        blob_id:        String,
        hint:           String,
        block_num:      u64,
        solver:         Option<address>,
        minted:         bool,
        expires_at:     u64,
        // allowlist: ai submit đúng được thêm vào → mint được NFT
        allowlist: Table<address, bool>,
    }

    public struct AllowlistCap has key, store {
        id:          UID,
        session_id:  u64,
        session_obj: ID,
    }

    public struct TxnHuntNFT has key, store {
        id:           UID,
        name:         String,
        description:  String,
        image_url:    String,
        metadata_url: String,
        difficulty:   u8,
        block_num:    u64,
        points:       u64,
        session_id:   u64,
        solved_at:    u64,
    }

    public struct SessionCreated has copy, drop {
        session_id: u64,
        difficulty: u8,
        expires_at: u64,
    }

    public struct AnswerSubmitted has copy, drop {
        session_id: u64,
        solver:     address,
    }

    public struct NFTMinted has copy, drop {
        session_id: u64,
        winner:     address,
        difficulty: u8,
        points:     u64,
    }

    public struct RoundRecord has store, copy, drop {
        round_id:   u64,
        difficulty: u8,
        block_num:  u64,
        blob_id:    String,          // walrus blob_id của round info
        winner:     Option<address>,
        minted_at:  u64,             // timestamp mint, 0 nếu chưa mint
        created_at: u64,
    }

    public struct RoundHistory has key {
        id:     UID,
        rounds: vector<RoundRecord>,
    }

    fun init(otw: GAME, ctx: &mut TxContext) {
        let publisher = package::claim(otw, ctx);
        let keys = vector[
            string::utf8(b"name"),
            string::utf8(b"description"),
            string::utf8(b"image_url"),
        ];
        let values = vector[
            string::utf8(b"{name}"),
            string::utf8(b"{description}"),
            string::utf8(b"{image_url}"),
        ];
        let mut display_obj = display::new_with_fields<TxnHuntNFT>(&publisher, keys, values, ctx);
        display::update_version(&mut display_obj);
        transfer::public_transfer(display_obj, tx_context::sender(ctx));
        transfer::public_transfer(publisher, tx_context::sender(ctx));
        transfer::transfer(AdminCap { id: object::new(ctx) }, tx_context::sender(ctx));
        transfer::share_object(GameConfig {
            id:              object::new(ctx),
            session_counter: 0,
            current_session: option::none(),
            easy_img_blob:   string::utf8(b""),
            medium_img_blob: string::utf8(b""),
            hard_img_blob:   string::utf8(b""),
            locked_img_blob: string::utf8(b""),
            admins:          table::new(ctx),
        });
        transfer::share_object(RoundHistory {
            id:     object::new(ctx),
            rounds: vector[],
        });
    }

    public fun is_admin(config: &GameConfig, addr: address): bool {
        addr == SUPER_ADMIN || table::contains(&config.admins, addr)
    }

    public entry fun add_admin(
        config:    &mut GameConfig,
        new_admin: address,
        ctx:       &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == SUPER_ADMIN, E_NOT_ADMIN);
        if (!table::contains(&config.admins, new_admin)) {
            table::add(&mut config.admins, new_admin, true);
        };
    }

    public entry fun remove_admin(
        config: &mut GameConfig,
        admin:  address,
        ctx:    &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == SUPER_ADMIN, E_NOT_ADMIN);
        assert!(admin != SUPER_ADMIN, E_CANNOT_REMOVE_SUPER);
        if (table::contains(&config.admins, admin)) {
            table::remove(&mut config.admins, admin);
        };
    }

    public entry fun set_nft_images(
        _cap:            &AdminCap,
        config:          &mut GameConfig,
        easy_img_blob:   vector<u8>,
        medium_img_blob: vector<u8>,
        hard_img_blob:   vector<u8>,
        locked_img_blob: vector<u8>,
    ) {
        config.easy_img_blob   = string::utf8(easy_img_blob);
        config.medium_img_blob = string::utf8(medium_img_blob);
        config.hard_img_blob   = string::utf8(hard_img_blob);
        config.locked_img_blob = string::utf8(locked_img_blob);
    }

    public entry fun create_session(
        _cap:        &AdminCap,
        config:      &mut GameConfig,
        history:     &mut RoundHistory,
        digest_hash: vector<u8>,
        difficulty:  u8,
        blob_id:     vector<u8>,
        hint:        vector<u8>,
        block_num:   u64,
        expires_at:  u64,
        clock:       &Clock,
        ctx:         &mut TxContext,
    ) {
        assert!(
            difficulty == DIFFICULTY_EASY
                || difficulty == DIFFICULTY_MEDIUM
                || difficulty == DIFFICULTY_HARD,
            E_INVALID_DIFFICULTY
        );
        assert!(clock::timestamp_ms(clock) < expires_at, E_SESSION_EXPIRED);

        config.session_counter = config.session_counter + 1;
        let session_id = config.session_counter;

        let session = Session {
            id:          object::new(ctx),
            session_id,
            digest_hash,
            difficulty,
            blob_id:     string::utf8(blob_id),
            hint:        string::utf8(hint),
            block_num,
            solver:      option::none(),
            minted:      false,
            expires_at,
            allowlist:   table::new(ctx),
        };

        // Ghi lịch sử round on-chain
        vector::push_back(&mut history.rounds, RoundRecord {
            round_id:   session_id,
            difficulty,
            block_num,
            blob_id:    string::utf8(blob_id),
            winner:     option::none(),
            minted_at:  0,
            created_at: clock::timestamp_ms(clock),
        });

        let session_obj_id = object::id(&session);
        event::emit(SessionCreated { session_id, difficulty, expires_at });
        transfer::share_object(session);
        config.current_session = option::some(session_obj_id);
    }

    /// Player submit digest đúng → nhận AllowlistCap → có thể mint NFT
    public entry fun submit_answer(
        session:      &mut Session,
        digest_input: vector<u8>,
        salt_input:   vector<u8>,
        clock:        &Clock,
        ctx:          &mut TxContext,
    ) {
        assert!(clock::timestamp_ms(clock) < session.expires_at, E_SESSION_EXPIRED);
        assert!(!session.minted, E_ALREADY_MINTED);
        assert!(option::is_none(&session.solver), E_ALREADY_SOLVED);

        let mut combined = digest_input;
        vector::append(&mut combined, salt_input);
        let computed_hash = hash::sha2_256(combined);
        assert!(computed_hash == session.digest_hash, E_WRONG_DIGEST);

        let solver = tx_context::sender(ctx);
        session.solver = option::some(solver);

        // Thêm solver vào allowlist
        table::add(&mut session.allowlist, solver, true);

        let cap = AllowlistCap {
            id:          object::new(ctx),
            session_id:  session.session_id,
            session_obj: object::id(session),
        };

        event::emit(AnswerSubmitted { session_id: session.session_id, solver });
        transfer::transfer(cap, solver);
    }

    /// Mint NFT — chỉ ai có AllowlistCap hợp lệ và là solver mới được mint
    public entry fun mint_nft(
        session:          &mut Session,
        cap:              AllowlistCap,
        config:           &GameConfig,
        history:          &mut RoundHistory,
        metadata_blob_id: vector<u8>,
        leaderboard:      &mut Leaderboard,
        witness:          GameWitness,
        clock:            &Clock,
        ctx:              &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);

        assert!(cap.session_id  == session.session_id,  E_WRONG_SESSION);
        assert!(cap.session_obj == object::id(session), E_WRONG_SESSION);
        assert!(!session.minted,                        E_ALREADY_MINTED);
        assert!(now < session.expires_at,               E_SESSION_EXPIRED);

        let minter = tx_context::sender(ctx);
        assert!(option::contains(&session.solver, &minter), E_NOT_IN_ALLOWLIST);

        session.minted = true;

        // Xoá khỏi allowlist sau khi mint
        if (table::contains(&session.allowlist, minter)) {
            table::remove(&mut session.allowlist, minter);
        };

        // Cập nhật winner trong lịch sử round
        let mut i = 0u64;
        let len = vector::length(&history.rounds);
        while (i < len) {
            let rec = vector::borrow_mut(&mut history.rounds, i);
            if (rec.round_id == session.session_id) {
                rec.winner    = option::some(minter);
                rec.minted_at = now;
                break
            };
            i = i + 1;
        };

        let points    = difficulty_points(session.difficulty);
        let img_blob  = resolve_image_blob(config, session.difficulty);
        let image_url = build_walrus_url(&img_blob);

        let nft = TxnHuntNFT {
            id:           object::new(ctx),
            name:         build_nft_name(session.session_id, session.difficulty),
            description:  build_nft_description(session.block_num),
            image_url,
            metadata_url: build_walrus_url(&string::utf8(metadata_blob_id)),
            difficulty:   session.difficulty,
            block_num:    session.block_num,
            points,
            session_id:   session.session_id,
            solved_at:    now,
        };

        event::emit(NFTMinted {
            session_id: session.session_id,
            winner:     minter,
            difficulty: session.difficulty,
            points,
        });

        leaderboard::add_score(leaderboard, witness, minter, points, clock, ctx);

        let AllowlistCap { id, session_id: _, session_obj: _ } = cap;
        object::delete(id);

        transfer::transfer(nft, minter);
    }

    public fun create_game_witness(): GameWitness {
        leaderboard::new_game_witness()
    }

    public fun session_hint(s: &Session): &String    { &s.hint }
    public fun session_blob_id(s: &Session): &String { &s.blob_id }
    public fun session_expires_at(s: &Session): u64  { s.expires_at }
    public fun session_minted(s: &Session): bool     { s.minted }
    public fun session_difficulty(s: &Session): u8   { s.difficulty }
    public fun session_id(s: &Session): u64          { s.session_id }
    public fun session_block_num(s: &Session): u64   { s.block_num }
    public fun session_has_solver(s: &Session): bool { option::is_some(&s.solver) }
    public fun config_counter(c: &GameConfig): u64   { c.session_counter }
    public fun config_current_session(c: &GameConfig): Option<ID> { c.current_session }

    public fun history_rounds(h: &RoundHistory): &vector<RoundRecord> { &h.rounds }
    public fun record_round_id(r: &RoundRecord): u64          { r.round_id }
    public fun record_difficulty(r: &RoundRecord): u8         { r.difficulty }
    public fun record_block_num(r: &RoundRecord): u64         { r.block_num }
    public fun record_blob_id(r: &RoundRecord): &String       { &r.blob_id }
    public fun record_winner(r: &RoundRecord): Option<address> { r.winner }
    public fun record_minted_at(r: &RoundRecord): u64         { r.minted_at }
    public fun record_created_at(r: &RoundRecord): u64        { r.created_at }

    fun difficulty_points(difficulty: u8): u64 {
        if (difficulty == DIFFICULTY_EASY)        { POINTS_EASY }
        else if (difficulty == DIFFICULTY_MEDIUM) { POINTS_MEDIUM }
        else                                      { POINTS_HARD }
    }

    fun resolve_image_blob(config: &GameConfig, difficulty: u8): String {
        if (difficulty == DIFFICULTY_EASY)        { config.easy_img_blob }
        else if (difficulty == DIFFICULTY_MEDIUM) { config.medium_img_blob }
        else                                      { config.hard_img_blob }
    }

    fun build_walrus_url(blob_id: &String): String {
        let mut url = string::utf8(WALRUS_BASE);
        string::append(&mut url, *blob_id);
        url
    }

    fun build_nft_name(session_id: u64, difficulty: u8): String {
        let mut s = string::utf8(b"TxnHunt #");
        string::append(&mut s, u64_to_string(session_id));
        string::append(&mut s, string::utf8(b" \xe2\x80\x94 "));
        if (difficulty == DIFFICULTY_EASY)        { string::append(&mut s, string::utf8(b"Easy")) }
        else if (difficulty == DIFFICULTY_MEDIUM) { string::append(&mut s, string::utf8(b"Medium")) }
        else                                      { string::append(&mut s, string::utf8(b"Hard")) };
        s
    }

    fun build_nft_description(block_num: u64): String {
        let mut s = string::utf8(b"Solved block ");
        string::append(&mut s, u64_to_string(block_num));
        string::append(&mut s, string::utf8(b" on Sui mainnet."));
        s
    }

    fun u64_to_string(n: u64): String {
        if (n == 0) return string::utf8(b"0");
        let mut bytes = vector[];
        let mut tmp = n;
        while (tmp > 0) {
            vector::push_back(&mut bytes, ((tmp % 10) as u8) + 48);
            tmp = tmp / 10;
        };
        vector::reverse(&mut bytes);
        string::utf8(bytes)
    }
}
