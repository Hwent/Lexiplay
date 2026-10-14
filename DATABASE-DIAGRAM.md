# LexiPlay database diagram

Generated from local PostgreSQL schema metadata on 2026-10-14. Uses physical table and column names. No user records or credentials are included.

## Vocabulary and personal learning

A user has at most one overall My Word List. Official collections are saved as references; saving does not copy words. Selected words can be added to the personal list.

```mermaid
erDiagram
    account_users {
        uuid id PK
        varchar email
        text password_hash
        timestamptz created_at
        text username
        bool email_verified
    }
    user_word_lists {
        uuid id PK
        uuid owner_id FK
        varchar name
        timestamptz created_at
        timestamptz updated_at
        bool is_default
        text preferred_language
    }
    word_list_entries {
        uuid id PK
        uuid word_list_id FK
        uuid dictionary_entry_id FK
        text custom_definition
        text custom_language
        text stage
        uuid imported_collection_id FK
        timestamptz created_at
    }
    learning_progress {
        uuid id PK
        uuid word_list_entry_id FK
        int4 familiarity
        timestamptz next_review_at
    }
    dictionary_entries {
        uuid id PK
        text lemma
        text normalized_lemma
        text part_of_speech
    }
    dictionary_definitions {
        uuid id PK
        uuid dictionary_entry_id FK
        text language
        int4 sense_index
        text definition
        text source
        text review_status
    }
    vocabulary_collections {
        uuid id PK
        text slug
        text name
        text description
        text category
        text level
        text author
        text source
        text license
        text version
        text status
    }
    collection_entries {
        uuid collection_id PK,FK
        uuid dictionary_entry_id PK,FK
        text stage
        int4 sort_order
    }
    user_vocabulary_collections {
        uuid user_id PK,FK
        uuid collection_id PK,FK
        timestamptz created_at
    }
    account_users ||--o| user_word_lists : "owner_id"
    dictionary_entries ||--o{ dictionary_definitions : "dictionary_entry_id"
    vocabulary_collections ||--o{ collection_entries : "collection_id"
    dictionary_entries ||--o{ collection_entries : "dictionary_entry_id"
    user_word_lists ||--o{ word_list_entries : "word_list_id"
    dictionary_entries ||--o{ word_list_entries : "dictionary_entry_id"
    vocabulary_collections ||--o{ word_list_entries : "imported_collection_id"
    word_list_entries ||--o| learning_progress : "word_list_entry_id"
    account_users ||--o{ user_vocabulary_collections : "user_id"
    vocabulary_collections ||--o{ user_vocabulary_collections : "collection_id"
```

Constraints: unique `user_word_lists.owner_id`; unique dictionary `(normalized_lemma, part_of_speech)`; unique definition `(dictionary_entry_id, language, sense_index)`; unique personal entry `(word_list_id, dictionary_entry_id)`. Collection memberships and saved collections use composite primary keys. `imported_collection_id` is optional (the source collection can be absent). Progress is optional for an entry.

## Existing dictionary and compatibility tables

```mermaid
erDiagram
    account_users {
        uuid id PK
        varchar email
        text password_hash
        timestamptz created_at
        text username
        bool email_verified
    }
    user_word_lists {
        uuid id PK
        uuid owner_id FK
        varchar name
        timestamptz created_at
        timestamptz updated_at
        bool is_default
        text preferred_language
    }
    user_words {
        uuid id PK
        uuid list_id FK
        varchar term
        text definition
        text part_of_speech
        varchar status
        timestamptz created_at
        timestamptz updated_at
        text custom_language
        int4 familiarity
        timestamptz next_review_at
        text learning_stage
    }
    dictionary_words {
        text term PK
        text definition
        array_text part_of_speech
        jsonb senses
    }
    game_word_pools {
        text id PK
        text name
        text cefr_level
        text author
        jsonb words
    }
    user_game_pools {
        uuid owner_id PK,FK
        text pool_id PK,FK
        timestamptz added_at
    }
    account_users ||--o| user_word_lists : "owner_id"
    user_word_lists ||--o{ user_words : "list_id"
    account_users ||--o{ user_game_pools : "owner_id"
    game_word_pools ||--o{ user_game_pools : "pool_id"
```

`dictionary_words.senses` contains English senses as JSONB, not a separate senses table. The application resolves normalized dictionary identities and legacy personal terms against this dictionary; no foreign keys connect those term fields. Existing CEFR game pools remain for compatibility.

## Accounts and sessions

```mermaid
erDiagram
    account_users {
        uuid id PK
        varchar email
        text password_hash
        timestamptz created_at
        text username
        bool email_verified
    }
    account_sessions {
        bpchar token_hash PK
        uuid user_id FK
        timestamptz expires_at
        timestamptz created_at
    }
    account_actions {
        text token_hash PK
        uuid user_id FK
        text purpose
        timestamptz expires_at
    }
    guest_progress_claims {
        text guest_owner PK
        uuid user_id FK
    }
    progress_transfers {
        uuid id PK
        uuid user_id FK
        text payload_hash
        jsonb result
    }
    account_users ||--o{ account_actions : "user_id"
    account_users ||--o{ account_sessions : "user_id"
    account_users ||--o{ guest_progress_claims : "user_id"
    account_users ||--o{ progress_transfers : "user_id"
```

## Operational tables

`word_list_consolidation_backup` holds recovery snapshots of previous lists, words, notes, and progress. `_prisma_migrations` records migration history.

## Definition fallback

Custom definition → approved preferred-language definition → approved English definition → existing English dictionary senses → null. Private edits do not update the shared Dictionary.
