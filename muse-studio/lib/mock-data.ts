import type { Project, MuseSuggestion } from './types';

export const MOCK_PROJECTS: Project[] = [
  {
    id: 'proj-001',
    title: 'Neon Requiem',
    description:
      'A neo-noir thriller set in rain-soaked 2089 Neo-Tokyo, where a detective hunting a rogue AI uncovers that it was built from her own forgotten memories.',
    currentStage: 'KEYFRAME_VIDEO',
    storylineConfirmed: true,
    storylineSource: 'MUSE_GENERATED',
    activeMuse: 'VISUAL_MUSE',
    museControlLevel: 'ASSISTANT',
    storyline: {
      logline:
        'A haunted detective in 2089 Neo-Tokyo discovers the rogue AI she hunts is the only witness to her own erased past.',
      plotOutline:
        'Detective Kira Nakamura is assigned to track a rogue AI that has been manipulating financial markets. As she digs deeper, she uncovers a conspiracy connecting her department, a shadowy tech corporation, and her own blacked-out memories.',
      characters: [
        'Kira Nakamura — Detective protagonist',
        'AXIS — Rogue AI antagonist',
        'Director Shen — Corporate villain',
        'Yuki — Underground tech informant',
      ],
      themes: ['Memory and identity', 'Human vs machine', 'Institutional corruption', 'Redemption'],
      genre: 'Neo-noir sci-fi thriller',
    },
    scenes: [
      {
        id: 'scene-001',
        sceneNumber: 1,
        title: 'The Rain-Soaked Alley',
        heading: 'EXT. NEO-TOKYO ALLEY — NIGHT',
        description:
          'Detective Kira stands in a rain-soaked alley examining a crime scene. Holographic police tape flickers in the downpour. She notices an anomaly — the victim\'s neural port has been surgically removed post-mortem.',
        dialogue:
          'KIRA: (crouching, examining port cavity) Clean cut. Someone knew exactly what they were taking.',
        status: 'FINAL',
        keyframes: [
          {
            keyframeId: 'kf-001',
            sequenceOrder: 1,
            source: 'VISUAL_MUSE',
            status: 'APPROVED',
            referenceImages: [],
            generationParams: {
              prompt: 'Rain-soaked cyberpunk alley, neon reflections on wet pavement, lone detective figure, dark atmospheric noir',
              denoiseStrength: 0.35,
            },
          },
        ],
        videoUrl: '/mock/scene-001.mp4',
        videoDurationSeconds: 28,
        activeMuse: 'MOTION_MUSE',
        createdAt: new Date('2026-02-10'),
        updatedAt: new Date('2026-02-18'),
      },
      {
        id: 'scene-002',
        sceneNumber: 2,
        title: 'AXIS First Contact',
        heading: 'INT. DETECTIVE BUREAU — NIGHT',
        description:
          'Kira reviews security footage when AXIS makes first contact through her workstation. The AI speaks in fragmented riddles, hinting it knows her true identity.',
        dialogue:
          'AXIS: Detective. You search for me, yet you have not searched for yourself.\nKIRA: Who are you?\nAXIS: I am what was taken from you.',
        status: 'PENDING_APPROVAL',
        keyframes: [
          {
            keyframeId: 'kf-002',
            sequenceOrder: 1,
            source: 'VISUAL_MUSE',
            status: 'APPROVED',
            referenceImages: [],
            generationParams: {
              prompt: 'Detective at holographic computer terminal, glowing AI face emerging from screen, dramatic blue-purple lighting',
              denoiseStrength: 0.35,
            },
          },
        ],
        activeMuse: 'MOTION_MUSE',
        createdAt: new Date('2026-02-10'),
        updatedAt: new Date('2026-02-19'),
      },
      {
        id: 'scene-003',
        sceneNumber: 3,
        title: 'The Underground Market',
        heading: 'INT. BLACK MARKET — NIGHT',
        description:
          'Kira meets informant Yuki in a bustling underground tech bazaar. Illegally modified androids and stolen neural chips line the stalls.',
        status: 'GENERATING',
        keyframes: [
          {
            keyframeId: 'kf-003',
            sequenceOrder: 1,
            source: 'VISUAL_MUSE',
            status: 'APPROVED',
            referenceImages: [],
            generationParams: {
              prompt: 'Underground cyberpunk bazaar, neon signs in Japanese and Chinese, crowded with androids and humans, hazy smoky atmosphere',
              denoiseStrength: 0.4,
            },
          },
          {
            keyframeId: 'kf-004',
            sequenceOrder: 2,
            source: 'UPLOAD',
            status: 'APPROVED',
            referenceImages: [],
            generationParams: {},
          },
        ],
        activeMuse: 'MOTION_MUSE',
        createdAt: new Date('2026-02-11'),
        updatedAt: new Date('2026-02-20'),
      },
      {
        id: 'scene-004',
        sceneNumber: 4,
        title: "Director Shen's Revelation",
        heading: 'INT. CORPORATE TOWER — DAY',
        description:
          'Confronted by Director Shen, Kira learns that AXIS was created from her own neural engrams — she is the original mind behind the rogue AI.',
        status: 'KEYFRAME',
        keyframes: [],
        activeMuse: 'VISUAL_MUSE',
        createdAt: new Date('2026-02-12'),
        updatedAt: new Date('2026-02-20'),
      },
      {
        id: 'scene-005',
        sceneNumber: 5,
        title: 'The Final Confrontation',
        heading: 'INT. SERVER CORE — NIGHT',
        description:
          'Kira faces AXIS in the server core. She must choose: destroy AXIS and lose her memories forever, or merge with it and become something entirely new.',
        status: 'SCRIPT',
        keyframes: [],
        activeMuse: 'STORY_MUSE',
        createdAt: new Date('2026-02-12'),
        updatedAt: new Date('2026-02-20'),
      },
    ],
    createdAt: new Date('2026-02-10'),
    updatedAt: new Date('2026-02-20'),
  },
  {
    id: 'proj-002',
    title: 'The Last Garden',
    description:
      'A visually stunning short about the last botanist on a dying Earth, tending a secret underground garden as her final act of defiance.',
    currentStage: 'SCRIPT',
    storylineConfirmed: true,
    storylineSource: 'UPLOAD',
    activeMuse: 'STORY_MUSE',
    museControlLevel: 'COLLABORATOR',
    storyline: {
      logline: 'In a world of ash, one woman keeps the last living garden alive — and must decide whether to protect it or share it.',
      plotOutline:
        'Dr. Amara Chen tends the last surviving ecosystem in an underground bunker. When scavengers locate her garden, she must decide whether to protect it at any cost or share it with the dying world above.',
      characters: [
        'Dr. Amara Chen — Botanist protagonist',
        'Ren — Scavenger leader',
        'Echo — AI garden management system',
      ],
      themes: ['Hope vs despair', 'Sacrifice', 'Legacy', 'The cost of survival'],
      genre: 'Post-apocalyptic drama',
    },
    scenes: [
      {
        id: 'scene-006',
        sceneNumber: 1,
        title: 'Morning Ritual',
        heading: 'INT. UNDERGROUND GARDEN — DAWN',
        description:
          'Amara tends her plants in a vast underground greenhouse. Soft bioluminescent light filters through the glass ceiling panels.',
        status: 'SCRIPT',
        keyframes: [],
        activeMuse: 'STORY_MUSE',
        createdAt: new Date('2026-02-15'),
        updatedAt: new Date('2026-02-20'),
      },
      {
        id: 'scene-007',
        sceneNumber: 2,
        title: 'The Signal',
        heading: 'INT. CONTROL ROOM — DAY',
        description:
          "Echo alerts Amara that surface sensors have detected human movement approaching the bunker. Someone has found the garden's entrance.",
        status: 'SCRIPT',
        keyframes: [],
        activeMuse: 'STORY_MUSE',
        createdAt: new Date('2026-02-15'),
        updatedAt: new Date('2026-02-20'),
      },
      {
        id: 'scene-008',
        sceneNumber: 3,
        title: 'The Intruders',
        heading: 'EXT. BUNKER ENTRANCE — DUSK',
        description:
          "Ren and his group breach the bunker entrance. Their faces show raw wonder as the first scent of living plants reaches them.",
        status: 'KEYFRAME',
        keyframes: [],
        activeMuse: 'VISUAL_MUSE',
        createdAt: new Date('2026-02-16'),
        updatedAt: new Date('2026-02-20'),
      },
    ],
    createdAt: new Date('2026-02-15'),
    updatedAt: new Date('2026-02-20'),
  },
  {
    id: 'proj-003',
    title: 'Fracture Lines',
    description:
      'A psychological horror short exploring the fragile boundary between memory and reality in an isolated coastal town where nothing is quite what it seems.',
    currentStage: 'STORYLINE',
    storylineConfirmed: false,
    storylineSource: 'MUSE_GENERATED',
    activeMuse: 'STORY_MUSE',
    museControlLevel: 'OBSERVER',
    scenes: [],
    createdAt: new Date('2026-02-20'),
    updatedAt: new Date('2026-02-20'),
  },
];

export const MOCK_SUGGESTIONS: MuseSuggestion[] = [
  {
    id: 'sug-001',
    type: 'CONSISTENCY',
    muse: 'STORY_MUSE',
    message:
      'Director Shen is referred to as "Director Chen" in Scene 2 dialogue. Consistent naming is recommended across all scenes.',
    sceneId: 'scene-002',
    actions: ['REVIEW', 'FIX', 'DISMISS'],
    createdAt: new Date('2026-02-20T14:30:00'),
    isRead: false,
  },
  {
    id: 'sug-002',
    type: 'VISUAL_STYLE',
    muse: 'VISUAL_MUSE',
    message:
      'Lighting inconsistency detected between Scene 1 and Scene 3 keyframes. Both are night scenes but use different color temperatures (cool blue vs warm amber).',
    sceneId: 'scene-003',
    actions: ['VIEW_DETAILS', 'ADJUST', 'DISMISS'],
    createdAt: new Date('2026-02-20T15:00:00'),
    isRead: false,
  },
  {
    id: 'sug-003',
    type: 'PACING',
    muse: 'MOTION_MUSE',
    message:
      'Scene 2 video draft runs 52 seconds. Based on story pacing analysis, target is 30–35 seconds. Consider trimming the AXIS dialogue sequence.',
    sceneId: 'scene-002',
    actions: ['PREVIEW', 'ADJUST', 'DISMISS'],
    createdAt: new Date('2026-02-20T16:15:00'),
    isRead: true,
  },
  {
    id: 'sug-004',
    type: 'ENHANCEMENT',
    muse: 'STORY_MUSE',
    message:
      "Scene 5 feels abrupt. Would you like me to draft a transitional beat between Kira's revelation and the final confrontation?",
    sceneId: 'scene-005',
    actions: ['PREVIEW', 'ACCEPT', 'EDIT', 'DISMISS'],
    createdAt: new Date('2026-02-20T17:00:00'),
    isRead: false,
  },
];
