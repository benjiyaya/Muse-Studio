import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Canonical DB path: muse-studio/db/muse.db (do not create muse.db in project root).
const DB_DIR = path.join(process.cwd(), 'db');
const DB_PATH = path.join(DB_DIR, 'muse.db');

declare global {
  // eslint-disable-next-line no-var
  var __museDb: Database.Database | undefined;
}

function openDatabase(): Database.Database {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const database = new Database(DB_PATH);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  applySchema(database);
  seedIfEmpty(database);
  return database;
}

function applySchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id                    TEXT PRIMARY KEY,
      title                 TEXT NOT NULL,
      description           TEXT,
      thumbnail             TEXT,
      storyline_logline     TEXT,
      storyline_plot_outline TEXT,
      storyline_characters  TEXT,
      storyline_themes      TEXT,
      storyline_genre       TEXT,
      storyline_source      TEXT NOT NULL DEFAULT 'MANUAL',
      storyline_confirmed   INTEGER NOT NULL DEFAULT 0,
      current_stage         TEXT NOT NULL DEFAULT 'STORYLINE',
      active_muse           TEXT NOT NULL DEFAULT 'STORY_MUSE',
      muse_control_level    TEXT NOT NULL DEFAULT 'ASSISTANT',
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id                      TEXT PRIMARY KEY,
      project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      scene_number            INTEGER NOT NULL,
      title                   TEXT NOT NULL,
      heading                 TEXT NOT NULL,
      description             TEXT NOT NULL,
      dialogue                TEXT,
      technical_notes         TEXT,
      status                  TEXT NOT NULL DEFAULT 'SCRIPT',
      video_url               TEXT,
      video_duration_seconds  REAL,
      active_muse             TEXT,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS keyframes (
      id                TEXT PRIMARY KEY,
      scene_id          TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      sequence_order    INTEGER NOT NULL,
      source            TEXT NOT NULL DEFAULT 'VISUAL_MUSE',
      status            TEXT NOT NULL DEFAULT 'DRAFT',
      draft_image_path  TEXT,
      final_image_path  TEXT,
      prompt            TEXT,
      denoise_strength  REAL,
      style_strength    REAL,
      aspect_ratio      TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reference_images (
      id          TEXT PRIMARY KEY,
      keyframe_id TEXT NOT NULL REFERENCES keyframes(id) ON DELETE CASCADE,
      url         TEXT NOT NULL,
      width       INTEGER NOT NULL DEFAULT 0,
      height      INTEGER NOT NULL DEFAULT 0,
      alt         TEXT
    );

    CREATE TABLE IF NOT EXISTS generation_jobs (
      id               TEXT PRIMARY KEY,
      scene_id         TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      backend_job_id   TEXT,
      provider_id      TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'queued',
      progress_percent INTEGER NOT NULL DEFAULT 0,
      message          TEXT,
      output_path      TEXT,
      error            TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS muse_suggestions (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      scene_id   TEXT REFERENCES scenes(id) ON DELETE SET NULL,
      type       TEXT NOT NULL,
      muse       TEXT NOT NULL,
      message    TEXT NOT NULL,
      actions    TEXT NOT NULL,
      is_read    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comfy_workflows (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      kind        TEXT NOT NULL DEFAULT 'image',
      json        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- Plugin Extensions (AddOn PlugIns Enable)
    -- Control-plane stored in Muse Studio (SQLite); runtime executes externally.
    CREATE TABLE IF NOT EXISTS plugins (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      version         TEXT NOT NULL,
      source_url     TEXT NOT NULL,
      repo            TEXT,
      branch_or_tag  TEXT,
      manifest_json  TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'installed',
      enabled         INTEGER NOT NULL DEFAULT 0,
      installed_at    TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      last_error      TEXT
    );

    CREATE TABLE IF NOT EXISTS plugin_endpoints (
      plugin_id          TEXT PRIMARY KEY REFERENCES plugins(id) ON DELETE CASCADE,
      base_url           TEXT NOT NULL,
      auth_type          TEXT NOT NULL DEFAULT 'none',
      auth_ref           TEXT,
      health_status      TEXT NOT NULL DEFAULT 'unknown',
      last_health_at     TEXT
    );

    CREATE TABLE IF NOT EXISTS plugin_hooks (
      plugin_id      TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      capability     TEXT NOT NULL,
      method         TEXT NOT NULL DEFAULT 'POST',
      path           TEXT NOT NULL,
      permissions_json TEXT,
      enabled        INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      PRIMARY KEY (plugin_id, capability)
    );

    CREATE TABLE IF NOT EXISTS plugin_ui_extensions (
      plugin_id        TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      slot             TEXT NOT NULL,
      bundle_url      TEXT NOT NULL,
      integrity_hash  TEXT,
      permissions_json TEXT,
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      PRIMARY KEY (plugin_id, slot, bundle_url)
    );

    CREATE TABLE IF NOT EXISTS plugin_settings (
      plugin_id   TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      key         TEXT NOT NULL,
      value       TEXT,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (plugin_id, key)
    );

    CREATE TABLE IF NOT EXISTS muse_chat_messages (
      id          TEXT PRIMARY KEY,
      project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
      muse_agent  TEXT NOT NULL,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_muse_chat_project_muse_created
      ON muse_chat_messages (project_id, muse_agent, created_at);

    -- Extensions MCP console sessions (/mcp-extensions)
    CREATE TABLE IF NOT EXISTS mcp_extensions_chat_sessions (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      pinned      INTEGER NOT NULL DEFAULT 0,
      project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
      scene_id    TEXT REFERENCES scenes(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- Extensions MCP console (/mcp-extensions): one row per user or assistant message
    CREATE TABLE IF NOT EXISTS mcp_extensions_chat_messages (
      sort_key    INTEGER PRIMARY KEY AUTOINCREMENT,
      id          TEXT NOT NULL UNIQUE,
      session_id  TEXT NOT NULL REFERENCES mcp_extensions_chat_sessions(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      tool_calls_json TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mcp_ext_chat_sort ON mcp_extensions_chat_messages (sort_key);
    CREATE INDEX IF NOT EXISTS idx_mcp_ext_chat_session_sort
      ON mcp_extensions_chat_messages (session_id, sort_key);

    -- Character sheets: per-project characters and their reference images
    CREATE TABLE IF NOT EXISTS characters (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      short_bio       TEXT,
      design_notes    TEXT,
      primary_role    TEXT,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      prompt_positive TEXT,
      prompt_negative TEXT,
      tags            TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_images (
      id           TEXT PRIMARY KEY,
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL DEFAULT 'general',
      image_path   TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT 'UPLOAD',
      width        INTEGER NOT NULL DEFAULT 0,
      height       INTEGER NOT NULL DEFAULT 0,
      notes        TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scene_characters (
      scene_id     TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      PRIMARY KEY (scene_id, character_id)
    );
  `);

  // Backfill comfy workflow columns on existing scenes tables
  try {
    database.exec(`ALTER TABLE scenes ADD COLUMN comfy_image_workflow_id TEXT`);
  } catch { /* column already exists */ }
  try {
    database.exec(`ALTER TABLE scenes ADD COLUMN comfy_video_workflow_id TEXT`);
  } catch { /* column already exists */ }
  try {
    database.exec(
      `ALTER TABLE plugin_hooks ADD COLUMN mcp_policy TEXT NOT NULL DEFAULT 'auto'`,
    );
  } catch {
    /* column already exists */
  }
  // MCP extensions multi-session migration
  const defaultSessionId = 'default';
  const now = new Date().toISOString();
  try {
    database.exec(`ALTER TABLE mcp_extensions_chat_messages ADD COLUMN session_id TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    database.exec(`ALTER TABLE mcp_extensions_chat_sessions ADD COLUMN project_id TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    database.exec(`ALTER TABLE mcp_extensions_chat_sessions ADD COLUMN scene_id TEXT`);
  } catch {
    /* column already exists */
  }
  database
    .prepare(
      `INSERT OR IGNORE INTO mcp_extensions_chat_sessions (id, title, pinned, created_at, updated_at)
       VALUES (@id, @title, 1, @now, @now)`,
    )
    .run({ id: defaultSessionId, title: 'General', now });
  database
    .prepare(
      `UPDATE mcp_extensions_chat_messages
       SET session_id = @sid
       WHERE session_id IS NULL OR TRIM(session_id) = ''`,
    )
    .run({ sid: defaultSessionId });
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_mcp_ext_chat_session_sort
      ON mcp_extensions_chat_messages (session_id, sort_key)`,
  );
}

function seedIfEmpty(database: Database.Database): void {
  const row = database
    .prepare<[], { cnt: number }>('SELECT COUNT(*) as cnt FROM projects')
    .get();
  if (!row || row.cnt > 0) return;

  const now = new Date().toISOString();

  const insertProject = database.prepare(`
    INSERT INTO projects (id, title, description, storyline_logline, storyline_plot_outline,
      storyline_characters, storyline_themes, storyline_genre, storyline_source,
      storyline_confirmed, current_stage, active_muse, muse_control_level, created_at, updated_at)
    VALUES (@id, @title, @description, @logline, @plotOutline, @characters, @themes, @genre,
      @storylineSource, @storylineConfirmed, @currentStage, @activeMuse, @museControlLevel,
      @createdAt, @updatedAt)
  `);

  const insertScene = database.prepare(`
    INSERT INTO scenes (id, project_id, scene_number, title, heading, description, dialogue,
      status, video_url, video_duration_seconds, active_muse, created_at, updated_at)
    VALUES (@id, @projectId, @sceneNumber, @title, @heading, @description, @dialogue,
      @status, @videoUrl, @videoDurationSeconds, @activeMuse, @createdAt, @updatedAt)
  `);

  const insertKeyframe = database.prepare(`
    INSERT INTO keyframes (id, scene_id, sequence_order, source, status, prompt,
      denoise_strength, draft_image_path, final_image_path, created_at, updated_at)
    VALUES (@id, @sceneId, @sequenceOrder, @source, @status, @prompt,
      @denoiseStrength, @draftImagePath, @finalImagePath, @createdAt, @updatedAt)
  `);

  const insertSuggestion = database.prepare(`
    INSERT INTO muse_suggestions (id, project_id, scene_id, type, muse, message, actions, is_read, created_at)
    VALUES (@id, @projectId, @sceneId, @type, @muse, @message, @actions, @isRead, @createdAt)
  `);

  const seedAll = database.transaction(() => {
    // --- Project 1: Neon Requiem ---
    insertProject.run({
      id: 'proj-001', title: 'Neon Requiem',
      description: 'A neo-noir thriller set in rain-soaked 2089 Neo-Tokyo, where a detective hunting a rogue AI uncovers that it was built from her own forgotten memories.',
      logline: 'A haunted detective in 2089 Neo-Tokyo discovers the rogue AI she hunts is the only witness to her own erased past.',
      plotOutline: 'Detective Kira Nakamura is assigned to track a rogue AI that has been manipulating financial markets. As she digs deeper, she uncovers a conspiracy connecting her department, a shadowy tech corporation, and her own blacked-out memories.',
      characters: JSON.stringify(['Kira Nakamura — Detective protagonist', 'AXIS — Rogue AI antagonist', 'Director Shen — Corporate villain', 'Yuki — Underground tech informant']),
      themes: JSON.stringify(['Memory and identity', 'Human vs machine', 'Institutional corruption', 'Redemption']),
      genre: 'Neo-noir sci-fi thriller', storylineSource: 'MUSE_GENERATED', storylineConfirmed: 1,
      currentStage: 'KEYFRAME_VIDEO', activeMuse: 'VISUAL_MUSE', museControlLevel: 'ASSISTANT',
      createdAt: '2026-02-10T00:00:00.000Z', updatedAt: '2026-02-20T00:00:00.000Z',
    });
    insertScene.run({ id: 'scene-001', projectId: 'proj-001', sceneNumber: 1, title: 'The Rain-Soaked Alley', heading: 'EXT. NEO-TOKYO ALLEY — NIGHT', description: "Detective Kira stands in a rain-soaked alley examining a crime scene. Holographic police tape flickers in the downpour. She notices an anomaly — the victim's neural port has been surgically removed post-mortem.", dialogue: "KIRA: (crouching, examining port cavity) Clean cut. Someone knew exactly what they were taking.", status: 'FINAL', videoUrl: null, videoDurationSeconds: 28, activeMuse: 'MOTION_MUSE', createdAt: '2026-02-10T00:00:00.000Z', updatedAt: '2026-02-18T00:00:00.000Z' });
    insertKeyframe.run({ id: 'kf-001', sceneId: 'scene-001', sequenceOrder: 1, source: 'VISUAL_MUSE', status: 'APPROVED', prompt: 'Rain-soaked cyberpunk alley, neon reflections on wet pavement, lone detective figure, dark atmospheric noir', denoiseStrength: 0.35, draftImagePath: null, finalImagePath: null, createdAt: now, updatedAt: now });
    insertScene.run({ id: 'scene-002', projectId: 'proj-001', sceneNumber: 2, title: 'AXIS First Contact', heading: 'INT. DETECTIVE BUREAU — NIGHT', description: 'Kira reviews security footage when AXIS makes first contact through her workstation. The AI speaks in fragmented riddles, hinting it knows her true identity.', dialogue: 'AXIS: Detective. You search for me, yet you have not searched for yourself.\nKIRA: Who are you?\nAXIS: I am what was taken from you.', status: 'PENDING_APPROVAL', videoUrl: null, videoDurationSeconds: null, activeMuse: 'MOTION_MUSE', createdAt: '2026-02-10T00:00:00.000Z', updatedAt: '2026-02-19T00:00:00.000Z' });
    insertKeyframe.run({ id: 'kf-002', sceneId: 'scene-002', sequenceOrder: 1, source: 'VISUAL_MUSE', status: 'APPROVED', prompt: 'Detective at holographic computer terminal, glowing AI face emerging from screen, dramatic blue-purple lighting', denoiseStrength: 0.35, draftImagePath: null, finalImagePath: null, createdAt: now, updatedAt: now });
    insertScene.run({ id: 'scene-003', projectId: 'proj-001', sceneNumber: 3, title: 'The Underground Market', heading: 'INT. BLACK MARKET — NIGHT', description: 'Kira meets informant Yuki in a bustling underground tech bazaar. Illegally modified androids and stolen neural chips line the stalls.', dialogue: null, status: 'GENERATING', videoUrl: null, videoDurationSeconds: null, activeMuse: 'MOTION_MUSE', createdAt: '2026-02-11T00:00:00.000Z', updatedAt: '2026-02-20T00:00:00.000Z' });
    insertKeyframe.run({ id: 'kf-003', sceneId: 'scene-003', sequenceOrder: 1, source: 'VISUAL_MUSE', status: 'APPROVED', prompt: 'Underground cyberpunk bazaar, neon signs in Japanese and Chinese, crowded with androids and humans, hazy smoky atmosphere', denoiseStrength: 0.4, draftImagePath: null, finalImagePath: null, createdAt: now, updatedAt: now });
    insertKeyframe.run({ id: 'kf-004', sceneId: 'scene-003', sequenceOrder: 2, source: 'UPLOAD', status: 'APPROVED', prompt: null, denoiseStrength: null, draftImagePath: null, finalImagePath: null, createdAt: now, updatedAt: now });
    insertScene.run({ id: 'scene-004', projectId: 'proj-001', sceneNumber: 4, title: "Director Shen's Revelation", heading: 'INT. CORPORATE TOWER — DAY', description: 'Confronted by Director Shen, Kira learns that AXIS was created from her own neural engrams — she is the original mind behind the rogue AI.', dialogue: null, status: 'KEYFRAME', videoUrl: null, videoDurationSeconds: null, activeMuse: 'VISUAL_MUSE', createdAt: '2026-02-12T00:00:00.000Z', updatedAt: '2026-02-20T00:00:00.000Z' });
    insertScene.run({ id: 'scene-005', projectId: 'proj-001', sceneNumber: 5, title: 'The Final Confrontation', heading: 'INT. SERVER CORE — NIGHT', description: 'Kira faces AXIS in the server core. She must choose: destroy AXIS and lose her memories forever, or merge with it and become something entirely new.', dialogue: null, status: 'SCRIPT', videoUrl: null, videoDurationSeconds: null, activeMuse: 'STORY_MUSE', createdAt: '2026-02-12T00:00:00.000Z', updatedAt: '2026-02-20T00:00:00.000Z' });

    // --- Project 2: The Last Garden ---
    insertProject.run({
      id: 'proj-002', title: 'The Last Garden',
      description: 'A visually stunning short about the last botanist on a dying Earth, tending a secret underground garden as her final act of defiance.',
      logline: 'In a world of ash, one woman keeps the last living garden alive — and must decide whether to protect it or share it.',
      plotOutline: 'Dr. Amara Chen tends the last surviving ecosystem in an underground bunker. When scavengers locate her garden, she must decide whether to protect it at any cost or share it with the dying world above.',
      characters: JSON.stringify(['Dr. Amara Chen — Botanist protagonist', 'Ren — Scavenger leader', 'Echo — AI garden management system']),
      themes: JSON.stringify(['Hope vs despair', 'Sacrifice', 'Legacy', 'The cost of survival']),
      genre: 'Post-apocalyptic drama', storylineSource: 'UPLOAD', storylineConfirmed: 1,
      currentStage: 'SCRIPT', activeMuse: 'STORY_MUSE', museControlLevel: 'COLLABORATOR',
      createdAt: '2026-02-15T00:00:00.000Z', updatedAt: '2026-02-20T00:00:00.000Z',
    });
    insertScene.run({ id: 'scene-006', projectId: 'proj-002', sceneNumber: 1, title: 'Morning Ritual', heading: 'INT. UNDERGROUND GARDEN — DAWN', description: 'Amara tends her plants in a vast underground greenhouse. Soft bioluminescent light filters through the glass ceiling panels.', dialogue: null, status: 'SCRIPT', videoUrl: null, videoDurationSeconds: null, activeMuse: 'STORY_MUSE', createdAt: '2026-02-15T00:00:00.000Z', updatedAt: '2026-02-20T00:00:00.000Z' });
    insertScene.run({ id: 'scene-007', projectId: 'proj-002', sceneNumber: 2, title: 'The Signal', heading: 'INT. CONTROL ROOM — DAY', description: "Echo alerts Amara that surface sensors have detected human movement approaching the bunker. Someone has found the garden's entrance.", dialogue: null, status: 'SCRIPT', videoUrl: null, videoDurationSeconds: null, activeMuse: 'STORY_MUSE', createdAt: '2026-02-15T00:00:00.000Z', updatedAt: '2026-02-20T00:00:00.000Z' });
    insertScene.run({ id: 'scene-008', projectId: 'proj-002', sceneNumber: 3, title: 'The Intruders', heading: 'EXT. BUNKER ENTRANCE — DUSK', description: "Ren and his group breach the bunker entrance. Their faces show raw wonder as the first scent of living plants reaches them.", dialogue: null, status: 'KEYFRAME', videoUrl: null, videoDurationSeconds: null, activeMuse: 'VISUAL_MUSE', createdAt: '2026-02-16T00:00:00.000Z', updatedAt: '2026-02-20T00:00:00.000Z' });

    // --- Project 3: Fracture Lines ---
    insertProject.run({
      id: 'proj-003', title: 'Fracture Lines',
      description: 'A psychological horror short exploring the fragile boundary between memory and reality in an isolated coastal town where nothing is quite what it seems.',
      logline: null, plotOutline: null, characters: null, themes: null, genre: null,
      storylineSource: 'MUSE_GENERATED', storylineConfirmed: 0,
      currentStage: 'STORYLINE', activeMuse: 'STORY_MUSE', museControlLevel: 'OBSERVER',
      createdAt: '2026-02-20T00:00:00.000Z', updatedAt: '2026-02-20T00:00:00.000Z',
    });

    // --- Project 4: The Last Signal (for Agent Debug / image2video testing) ---
    insertProject.run({
      id: 'proj-004', title: 'The Last Signal',
      description: 'A short film about the last transmission from a dying outpost and the person who receives it.',
      logline: 'As the last relay station goes dark, one operator must choose between saving the signal or saving themselves.',
      plotOutline: 'Operator Rey maintains the final relay in a dead zone. When the last expected transmission arrives, it is not from command but from a stranger—and the message changes everything.',
      characters: JSON.stringify(['Rey — Relay operator', 'Voice — Unknown sender']),
      themes: JSON.stringify(['Isolation', 'Hope', 'Legacy']),
      genre: 'Sci-fi drama', storylineSource: 'MANUAL', storylineConfirmed: 1,
      currentStage: 'KEYFRAME_VIDEO', activeMuse: 'MOTION_MUSE', museControlLevel: 'ASSISTANT',
      createdAt: '2026-02-21T00:00:00.000Z', updatedAt: '2026-02-21T00:00:00.000Z',
    });
    insertScene.run({ id: 'scene-009', projectId: 'proj-004', sceneNumber: 1, title: 'The Transmission', heading: 'INT. RELAY STATION — NIGHT', description: 'Rey watches the waveform of the last incoming signal. Static gives way to a voice. She reaches for the record button.', dialogue: null, status: 'DRAFT_QUEUE', videoUrl: null, videoDurationSeconds: null, activeMuse: 'MOTION_MUSE', createdAt: '2026-02-21T00:00:00.000Z', updatedAt: '2026-02-21T00:00:00.000Z' });
    insertKeyframe.run({ id: 'kf-009', sceneId: 'scene-009', sequenceOrder: 1, source: 'VISUAL_MUSE', status: 'APPROVED', prompt: 'Relay station control room, single operator at console, waveform on screen, dim blue lighting', denoiseStrength: 0.35, draftImagePath: 'keyframes/kf-009-draft.png', finalImagePath: null, createdAt: now, updatedAt: now });

    // --- Default settings ---
    const insertSetting = database.prepare(`
      INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    `);
    insertSetting.run('llm_provider', 'ollama', now);
    insertSetting.run('ollama_base_url', 'http://localhost:11434', now);
    insertSetting.run('ollama_model', 'llama3.2', now);

    // --- Sample suggestions ---
    insertSuggestion.run({ id: 'sug-001', projectId: 'proj-001', sceneId: 'scene-002', type: 'CONSISTENCY', muse: 'STORY_MUSE', message: 'Director Shen is referred to as "Director Chen" in Scene 2 dialogue. Consistent naming is recommended across all scenes.', actions: JSON.stringify(['REVIEW', 'FIX', 'DISMISS']), isRead: 0, createdAt: '2026-02-20T14:30:00.000Z' });
    insertSuggestion.run({ id: 'sug-002', projectId: 'proj-001', sceneId: 'scene-003', type: 'VISUAL_STYLE', muse: 'VISUAL_MUSE', message: 'Lighting inconsistency detected between Scene 1 and Scene 3 keyframes. Both are night scenes but use different color temperatures (cool blue vs warm amber).', actions: JSON.stringify(['VIEW_DETAILS', 'ADJUST', 'DISMISS']), isRead: 0, createdAt: '2026-02-20T15:00:00.000Z' });
    insertSuggestion.run({ id: 'sug-003', projectId: 'proj-001', sceneId: 'scene-002', type: 'PACING', muse: 'MOTION_MUSE', message: 'Scene 2 video draft runs 52 seconds. Based on story pacing analysis, target is 30–35 seconds. Consider trimming the AXIS dialogue sequence.', actions: JSON.stringify(['PREVIEW', 'ADJUST', 'DISMISS']), isRead: 1, createdAt: '2026-02-20T16:15:00.000Z' });
    insertSuggestion.run({ id: 'sug-004', projectId: 'proj-001', sceneId: 'scene-005', type: 'ENHANCEMENT', muse: 'STORY_MUSE', message: "Scene 5 feels abrupt. Would you like me to draft a transitional beat between Kira's revelation and the final confrontation?", actions: JSON.stringify(['PREVIEW', 'ACCEPT', 'EDIT', 'DISMISS']), isRead: 0, createdAt: '2026-02-20T17:00:00.000Z' });
  });

  seedAll();
}

export const db: Database.Database =
  process.env.NODE_ENV === 'production'
    ? openDatabase()
    : (global.__museDb ??= openDatabase());
